"""Best-effort RFC 7009 token revocation for sign-out.

Mirrors inno-platform Connections' disconnect semantics: the local token
delete always wins — revocation is attempted first but a failure at any
step (no metadata, no revocation_endpoint, network error, upstream 4xx/5xx)
only downgrades the result, it never blocks sign-out.

Returns:
    None  — nothing stored for this server (nothing to revoke)
    True  — upstream acknowledged the revocation
    False — revocation was attempted/skipped but did not succeed
"""

from __future__ import annotations

import logging
from urllib.parse import urlparse

import httpx

logger = logging.getLogger(__name__)

REVOKE_TIMEOUT = 5.0


def _metadata_urls(server_url: str) -> list[str]:
    """Candidate RFC 9728 protected-resource metadata URLs for an MCP server."""
    parsed = urlparse(server_url)
    origin = f"{parsed.scheme}://{parsed.netloc}"
    path = parsed.path.rstrip("/")
    urls = []
    if path:
        urls.append(f"{origin}/.well-known/oauth-protected-resource{path}")
    urls.append(f"{origin}/.well-known/oauth-protected-resource")
    return urls


def _as_metadata_urls(auth_server: str) -> list[str]:
    """Candidate RFC 8414 / OIDC discovery URLs for an authorization server."""
    parsed = urlparse(auth_server)
    origin = f"{parsed.scheme}://{parsed.netloc}"
    path = parsed.path.rstrip("/")
    urls = []
    if path:
        urls.append(f"{origin}/.well-known/oauth-authorization-server{path}")
        urls.append(f"{origin}{path}/.well-known/openid-configuration")
    urls.append(f"{origin}/.well-known/oauth-authorization-server")
    urls.append(f"{origin}/.well-known/openid-configuration")
    return urls


async def _get_json(client: httpx.AsyncClient, url: str) -> dict | None:
    try:
        resp = await client.get(url, timeout=REVOKE_TIMEOUT)
        if resp.status_code == 200:
            data = resp.json()
            if isinstance(data, dict):
                return data
    except Exception:
        logger.debug("Metadata fetch failed for %s", url, exc_info=True)
    return None


async def _find_revocation_endpoint(
    client: httpx.AsyncClient, server_url: str
) -> str | None:
    auth_servers: list[str] = []
    for url in _metadata_urls(server_url):
        prm = await _get_json(client, url)
        if prm and prm.get("authorization_servers"):
            auth_servers = [s for s in prm["authorization_servers"] if isinstance(s, str)]
            break
    if not auth_servers:
        # Combined AS/RS deployments serve AS metadata from the MCP origin itself.
        parsed = urlparse(server_url)
        auth_servers = [f"{parsed.scheme}://{parsed.netloc}"]
    for auth_server in auth_servers:
        for url in _as_metadata_urls(auth_server):
            meta = await _get_json(client, url)
            if meta and meta.get("revocation_endpoint"):
                return str(meta["revocation_endpoint"])
    return None


async def try_revoke(
    server_url: str, tokens, client_info, httpx_client_factory=None
) -> bool | None:
    """Attempt RFC 7009 revocation of the stored tokens. Never raises."""
    if tokens is None:
        return None
    try:
        token = getattr(tokens, "refresh_token", None)
        hint = "refresh_token"
        if not token:
            token = getattr(tokens, "access_token", None)
            hint = "access_token"
        if not token:
            return None

        factory = httpx_client_factory or httpx.AsyncClient
        async with factory() as client:
            endpoint = await _find_revocation_endpoint(client, server_url)
            if not endpoint:
                return False

            data = {"token": token, "token_type_hint": hint}
            basic = None
            client_id = getattr(client_info, "client_id", None)
            client_secret = getattr(client_info, "client_secret", None)
            auth_method = getattr(client_info, "token_endpoint_auth_method", None)
            if client_id and client_secret and auth_method == "client_secret_basic":
                basic = httpx.BasicAuth(client_id, client_secret)
            elif client_id and client_secret:
                data["client_id"] = client_id
                data["client_secret"] = client_secret
            elif client_id:
                data["client_id"] = client_id

            resp = await client.post(
                endpoint, data=data, auth=basic, timeout=REVOKE_TIMEOUT
            )
            return resp.status_code < 300
    except Exception:
        logger.debug("Token revocation failed for %s", server_url, exc_info=True)
        return False
