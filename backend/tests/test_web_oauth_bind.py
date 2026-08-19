"""Tests for WebOAuth._bind: static client info, CIMD, and public-client fallback."""

from __future__ import annotations

from backend.auth.oauth import WebOAuth

REDIRECT = "http://localhost:5173/oauth/callback"
MCP_URL = "https://example.com/mcp"


def _bind(**kwargs) -> WebOAuth:
    w = WebOAuth(redirect_url=REDIRECT, client_name="MCPeriscope", **kwargs)
    w._bind(MCP_URL)
    return w


def test_pre_registered_client_defaults_to_post():
    w = _bind(client_id="cid", client_secret="sec")
    ci = w._static_client_info
    assert ci is not None
    assert ci.client_id == "cid"
    assert ci.client_secret == "sec"
    assert ci.token_endpoint_auth_method == "client_secret_post"
    assert [str(u) for u in ci.redirect_uris] == [REDIRECT]


def test_pre_registered_client_basic_override():
    w = _bind(
        client_id="cid",
        client_secret="sec",
        additional_client_metadata={"token_endpoint_auth_method": "client_secret_basic"},
    )
    assert w._static_client_info.token_endpoint_auth_method == "client_secret_basic"


def test_client_id_without_secret_is_public():
    w = _bind(client_id="cid")
    ci = w._static_client_info
    assert ci.client_secret is None
    # HeadlessOAuth forces the public-client method when no secret is given.
    assert ci.token_endpoint_auth_method == "none"


def test_no_client_forces_public_registration():
    w = _bind()
    assert w._static_client_info is None
    assert w.context.client_metadata.token_endpoint_auth_method == "none"


def test_scopes_flow_into_client_metadata():
    w = _bind(scopes="openid profile")
    assert w.context.client_metadata.scope == "openid profile"
    w2 = _bind(scopes=["a", "b"])
    assert w2.context.client_metadata.scope == "a b"


def test_client_metadata_url_passthrough():
    url = "https://example.com/oauth/client.json"
    w = _bind(client_metadata_url=url)
    assert w.context.client_metadata_url == url


def test_web_redirect_used_not_localhost_callback():
    w = _bind()
    assert [str(u) for u in w.context.client_metadata.redirect_uris] == [REDIRECT]
    assert w.redirect_port == 0
