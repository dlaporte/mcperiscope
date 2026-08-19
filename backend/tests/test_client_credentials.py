"""Tests for the client-credentials auth (mint, cache, refresh, errors)."""

from __future__ import annotations

import asyncio
import base64
import json
import time
from urllib.parse import parse_qs

import httpx
import pytest

from backend.auth.client_credentials import (
    DEFAULT_MINT_TTL_SECONDS,
    ClientCredentialsAuth,
    ClientCredentialsError,
)

TOKEN_URL = "https://idp.example/token"
RESOURCE_URL = "https://api.example/data"


class TokenEndpoint:
    """Programmable stub token endpoint riding httpx.MockTransport."""

    def __init__(self, responses: list[dict | tuple[int, dict]] | None = None,
                 delay: float = 0.0):
        self.requests: list[httpx.Request] = []
        self.responses = responses or []
        self.delay = delay

    async def handler(self, request: httpx.Request) -> httpx.Response:
        if self.delay:
            await asyncio.sleep(self.delay)
        self.requests.append(request)
        if self.responses:
            item = self.responses.pop(0)
        else:
            item = {"access_token": f"tok{len(self.requests)}", "expires_in": 3600}
        if isinstance(item, tuple):
            status, body = item
        else:
            status, body = 200, item
        return httpx.Response(status, json=body)

    def factory(self):
        return httpx.AsyncClient(transport=httpx.MockTransport(self.handler))

    def form(self, i: int = 0) -> dict:
        return {k: v[0] for k, v in parse_qs(self.requests[i].content.decode()).items()}


def _auth(endpoint: TokenEndpoint, **kwargs) -> ClientCredentialsAuth:
    return ClientCredentialsAuth(
        token_endpoint=TOKEN_URL,
        client_id="cid",
        client_secret="sec",
        httpx_client_factory=endpoint.factory,
        **kwargs,
    )


def _resource_client(auth, handler=None):
    async def ok(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"ok": True})

    return httpx.AsyncClient(auth=auth, transport=httpx.MockTransport(handler or ok))


def test_mint_post_mode():
    ep = TokenEndpoint()
    auth = _auth(ep, scope="read write")

    async def run():
        async with _resource_client(auth) as client:
            resp = await client.get(RESOURCE_URL)
        return resp

    resp = asyncio.run(run())
    assert resp.request.headers["Authorization"] == "Bearer tok1"
    form = ep.form()
    assert form["grant_type"] == "client_credentials"
    assert form["client_id"] == "cid"
    assert form["client_secret"] == "sec"
    assert form["scope"] == "read write"
    assert "Authorization" not in ep.requests[0].headers


def test_mint_basic_mode():
    ep = TokenEndpoint()
    auth = _auth(ep, client_auth="basic")

    async def run():
        async with _resource_client(auth) as client:
            await client.get(RESOURCE_URL)

    asyncio.run(run())
    expected = base64.b64encode(b"cid:sec").decode()
    assert ep.requests[0].headers["Authorization"] == f"Basic {expected}"
    form = ep.form()
    assert "client_secret" not in form
    assert "client_id" not in form


def test_cache_reuse_single_mint():
    ep = TokenEndpoint()
    auth = _auth(ep)

    async def run():
        async with _resource_client(auth) as client:
            await client.get(RESOURCE_URL)
            await client.get(RESOURCE_URL)

    asyncio.run(run())
    assert len(ep.requests) == 1


def test_proactive_remint_under_threshold():
    ep = TokenEndpoint()
    auth = _auth(ep)

    async def run():
        async with _resource_client(auth) as client:
            await client.get(RESOURCE_URL)
            auth._expires_at = time.monotonic() + 30  # < 60s threshold
            await client.get(RESOURCE_URL)

    asyncio.run(run())
    assert len(ep.requests) == 2


def test_default_ttl_when_expires_in_absent():
    ep = TokenEndpoint(responses=[{"access_token": "t"}])
    auth = _auth(ep)

    async def run():
        async with _resource_client(auth) as client:
            await client.get(RESOURCE_URL)

    asyncio.run(run())
    remaining = auth._expires_at - time.monotonic()
    assert DEFAULT_MINT_TTL_SECONDS - 5 < remaining <= DEFAULT_MINT_TTL_SECONDS


def test_401_triggers_single_remint_retry():
    ep = TokenEndpoint()
    auth = _auth(ep)
    resource_hits = []

    async def resource(request: httpx.Request) -> httpx.Response:
        resource_hits.append(request.headers["Authorization"])
        if len(resource_hits) == 1:
            return httpx.Response(401)
        return httpx.Response(200, json={"ok": True})

    async def run():
        async with _resource_client(auth, resource) as client:
            return await client.get(RESOURCE_URL)

    resp = asyncio.run(run())
    assert resp.status_code == 200
    assert resource_hits == ["Bearer tok1", "Bearer tok2"]
    assert len(ep.requests) == 2


def test_persistent_401_retries_only_once():
    ep = TokenEndpoint()
    auth = _auth(ep)
    hits = []

    async def resource(request: httpx.Request) -> httpx.Response:
        hits.append(1)
        return httpx.Response(401)

    async def run():
        async with _resource_client(auth, resource) as client:
            return await client.get(RESOURCE_URL)

    resp = asyncio.run(run())
    assert resp.status_code == 401
    assert len(hits) == 2


@pytest.mark.parametrize(
    "error_code,expected_fragment",
    [
        ("invalid_client", "client ID/secret"),
        ("unauthorized_client", "client ID/secret"),
        ("invalid_grant", "client-credentials flow"),
        ("invalid_scope", "scope was rejected"),
    ],
)
def test_error_mapping(error_code, expected_fragment):
    ep = TokenEndpoint(responses=[(400, {"error": error_code})])
    auth = ClientCredentialsAuth(
        token_endpoint=TOKEN_URL,
        client_id="cid",
        client_secret="s3cr3t-value-xyz",
        scope="read",
        httpx_client_factory=ep.factory,
    )

    async def run():
        async with _resource_client(auth) as client:
            await client.get(RESOURCE_URL)

    with pytest.raises(ClientCredentialsError) as exc:
        asyncio.run(run())
    assert expected_fragment in str(exc.value)
    assert "s3cr3t-value-xyz" not in str(exc.value)  # never leak the secret


def test_missing_access_token_errors():
    ep = TokenEndpoint(responses=[{"token_type": "Bearer"}])
    auth = _auth(ep)

    async def run():
        async with _resource_client(auth) as client:
            await client.get(RESOURCE_URL)

    with pytest.raises(ClientCredentialsError, match="no access_token"):
        asyncio.run(run())


def test_concurrent_requests_single_flight():
    ep = TokenEndpoint(delay=0.05)
    auth = _auth(ep)

    async def run():
        async with _resource_client(auth) as client:
            await asyncio.gather(client.get(RESOURCE_URL), client.get(RESOURCE_URL))

    asyncio.run(run())
    assert len(ep.requests) == 1
