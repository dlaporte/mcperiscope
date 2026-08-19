"""Tests for sign-out: local token deletion, revocation best-effort, route contract."""

from __future__ import annotations

import asyncio

import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient
from mcp.shared.auth import OAuthClientInformationFull, OAuthToken
from pydantic import AnyHttpUrl

from backend import mcp_manager
from backend.auth import revocation
from backend.mcp_optimizer.token_store import FileKeyValueStore

SERVER_URL = "https://srv.example/mcp"
REDIRECT = "http://localhost:5173/oauth/callback"


def _adapter(base_dir, url=SERVER_URL):
    from fastmcp.client.auth.oauth import TokenStorageAdapter

    return TokenStorageAdapter(
        async_key_value=FileKeyValueStore(base_dir), server_url=url
    )


def _seed(base_dir, refresh: bool = True):
    async def run():
        adapter = _adapter(base_dir)
        await adapter.set_tokens(
            OAuthToken(
                access_token="at",
                token_type="Bearer",
                refresh_token="rt" if refresh else None,
                expires_in=3600,
            )
        )
        await adapter.set_client_info(
            OAuthClientInformationFull(
                client_id="cid",
                client_secret="sec",
                token_endpoint_auth_method="client_secret_post",
                redirect_uris=[AnyHttpUrl(REDIRECT)],
            )
        )

    asyncio.run(run())


async def _no_revoke(*args, **kwargs):
    return False


def test_signout_clears_local_store(tmp_path, monkeypatch):
    _seed(tmp_path)
    monkeypatch.setattr(mcp_manager, "TOKEN_DIR", tmp_path)
    monkeypatch.setattr(revocation, "try_revoke", _no_revoke)

    result = asyncio.run(mcp_manager.signout(SERVER_URL))

    assert result["status"] == "signed_out"
    assert result["revoked"] is False

    async def check():
        adapter = _adapter(tmp_path)
        return await adapter.get_tokens(), await adapter.get_client_info()

    tokens, info = asyncio.run(check())
    assert tokens is None
    assert info is None


def test_signout_normalizes_trailing_slash(tmp_path, monkeypatch):
    _seed(tmp_path)
    monkeypatch.setattr(mcp_manager, "TOKEN_DIR", tmp_path)
    monkeypatch.setattr(revocation, "try_revoke", _no_revoke)

    result = asyncio.run(mcp_manager.signout(SERVER_URL + "/"))

    assert result["url"] == SERVER_URL
    tokens = asyncio.run(_adapter(tmp_path).get_tokens())
    assert tokens is None


def test_signout_disconnects_live_connection(tmp_path, monkeypatch):
    monkeypatch.setattr(mcp_manager, "TOKEN_DIR", tmp_path)
    monkeypatch.setattr(revocation, "try_revoke", _no_revoke)
    monkeypatch.setattr(mcp_manager, "_url", SERVER_URL)
    calls = []

    async def fake_disconnect():
        calls.append(1)
        return {"status": "disconnected"}

    monkeypatch.setattr(mcp_manager, "disconnect", fake_disconnect)
    asyncio.run(mcp_manager.signout(SERVER_URL))
    assert calls == [1]


def test_signout_with_nothing_stored(tmp_path, monkeypatch):
    monkeypatch.setattr(mcp_manager, "TOKEN_DIR", tmp_path)
    result = asyncio.run(mcp_manager.signout(SERVER_URL))
    assert result["status"] == "signed_out"
    assert result["revoked"] is None  # nothing to revoke


# ---------------------------------------------------------------------------
# RFC 7009 revocation
# ---------------------------------------------------------------------------

def _mock_factory(routes: dict[str, httpx.Response], hits: list[httpx.Request]):
    async def handler(request: httpx.Request) -> httpx.Response:
        hits.append(request)
        return routes.get(str(request.url), httpx.Response(404))

    return lambda: httpx.AsyncClient(transport=httpx.MockTransport(handler))


def _tokens(refresh=True):
    return OAuthToken(
        access_token="at",
        token_type="Bearer",
        refresh_token="rt" if refresh else None,
    )


def _client_info():
    return OAuthClientInformationFull(
        client_id="cid",
        client_secret="sec",
        token_endpoint_auth_method="client_secret_post",
        redirect_uris=[AnyHttpUrl(REDIRECT)],
    )


def test_try_revoke_nothing_stored():
    assert asyncio.run(revocation.try_revoke(SERVER_URL, None, None)) is None


def test_try_revoke_happy_path():
    hits: list[httpx.Request] = []
    routes = {
        "https://srv.example/.well-known/oauth-protected-resource/mcp": httpx.Response(
            200, json={"authorization_servers": ["https://idp.example"]}
        ),
        "https://idp.example/.well-known/oauth-authorization-server": httpx.Response(
            200,
            json={
                "issuer": "https://idp.example",
                "revocation_endpoint": "https://idp.example/revoke",
            },
        ),
        "https://idp.example/revoke": httpx.Response(200),
    }
    result = asyncio.run(
        revocation.try_revoke(
            SERVER_URL, _tokens(), _client_info(),
            httpx_client_factory=_mock_factory(routes, hits),
        )
    )
    assert result is True
    revoke_req = hits[-1]
    body = revoke_req.content.decode()
    assert "token=rt" in body  # prefers the refresh token
    assert "token_type_hint=refresh_token" in body
    assert "client_id=cid" in body
    assert "client_secret=sec" in body


def test_try_revoke_upstream_error_returns_false():
    hits: list[httpx.Request] = []
    routes = {
        "https://srv.example/.well-known/oauth-protected-resource/mcp": httpx.Response(
            200, json={"authorization_servers": ["https://idp.example"]}
        ),
        "https://idp.example/.well-known/oauth-authorization-server": httpx.Response(
            200, json={"revocation_endpoint": "https://idp.example/revoke"}
        ),
        "https://idp.example/revoke": httpx.Response(500),
    }
    result = asyncio.run(
        revocation.try_revoke(
            SERVER_URL, _tokens(), _client_info(),
            httpx_client_factory=_mock_factory(routes, hits),
        )
    )
    assert result is False


def test_try_revoke_no_endpoint_returns_false():
    result = asyncio.run(
        revocation.try_revoke(
            SERVER_URL, _tokens(), _client_info(),
            httpx_client_factory=_mock_factory({}, []),
        )
    )
    assert result is False


def test_revocation_failure_never_blocks_signout(tmp_path, monkeypatch):
    _seed(tmp_path)
    monkeypatch.setattr(mcp_manager, "TOKEN_DIR", tmp_path)

    async def failing_revoke(*args, **kwargs):
        return False

    monkeypatch.setattr(revocation, "try_revoke", failing_revoke)
    result = asyncio.run(mcp_manager.signout(SERVER_URL))
    assert result["status"] == "signed_out"
    assert asyncio.run(_adapter(tmp_path).get_tokens()) is None


# ---------------------------------------------------------------------------
# Route contract
# ---------------------------------------------------------------------------

def _app():
    from backend.routes import auth_routes

    app = FastAPI()
    app.include_router(auth_routes.router, prefix="/api")
    return app


def test_signout_route_contract(monkeypatch):
    async def fake_signout(url: str):
        return {"status": "signed_out", "url": url, "revoked": None}

    monkeypatch.setattr(mcp_manager, "signout", fake_signout)
    client = TestClient(_app())
    resp = client.post("/api/auth/signout", json={"url": "https://127.0.0.1/mcp"})
    assert resp.status_code == 200
    assert resp.json() == {
        "status": "signed_out", "url": "https://127.0.0.1/mcp", "revoked": None,
    }


def test_signout_route_rejects_bad_url():
    client = TestClient(_app())
    resp = client.post("/api/auth/signout", json={"url": "ftp://example.com/x"})
    assert resp.status_code == 400
