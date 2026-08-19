"""OAuth 2.1 client-credentials auth for upstream MCP servers.

Mints access tokens with the user's own client ID/secret pair at a fixed
token endpoint and injects them as Bearer headers. Tokens are cached in
memory and re-minted proactively before expiry, plus once on a 401.

Mirrors inno-platform's Connections ``oauth2_client_creds`` strategy
constants: 60s proactive refresh threshold, 15-minute default TTL when the
token response omits ``expires_in``, 30s token-request timeout.
"""

from __future__ import annotations

import asyncio
import time
from typing import Callable

import httpx

DEFAULT_MINT_TTL_SECONDS = 15 * 60
REFRESH_THRESHOLD_SECONDS = 60
TOKEN_REQUEST_TIMEOUT = 30.0

_ERROR_HINTS = {
    "invalid_client": (
        "The authorization server rejected the client credentials. Check the "
        "client ID/secret and whether the server requires 'post' or 'basic' "
        "client authentication."
    ),
    "unauthorized_client": (
        "The authorization server rejected the client credentials. Check the "
        "client ID/secret and whether the server requires 'post' or 'basic' "
        "client authentication."
    ),
    "invalid_grant": (
        "The server rejected the client_credentials grant. Verify this client "
        "is allowed to use the client-credentials flow."
    ),
}


class ClientCredentialsError(RuntimeError):
    """Actionable failure minting a client-credentials token."""


def _map_error(resp: httpx.Response, scope: str | None) -> str:
    code = None
    try:
        code = resp.json().get("error")
    except Exception:
        pass
    if code in _ERROR_HINTS:
        return _ERROR_HINTS[code]
    if code == "invalid_scope":
        return f"The requested scope was rejected: {scope or '(none)'}."
    detail = f" ({code})" if code else ""
    return f"Token endpoint returned HTTP {resp.status_code}{detail}."


class ClientCredentialsAuth(httpx.Auth):
    """httpx auth that mints and refreshes client-credentials tokens."""

    requires_response_body = True

    def __init__(
        self,
        token_endpoint: str,
        client_id: str,
        client_secret: str,
        scope: str | None = None,
        client_auth: str = "post",
        httpx_client_factory: Callable[[], httpx.AsyncClient] | None = None,
    ) -> None:
        self._token_endpoint = token_endpoint
        self._client_id = client_id
        self._client_secret = client_secret
        self._scope = scope
        self._client_auth = client_auth
        self._client_factory = httpx_client_factory or httpx.AsyncClient
        self._access_token: str | None = None
        self._expires_at: float = 0.0
        # Created lazily inside the running event loop.
        self._lock: asyncio.Lock | None = None

    async def async_auth_flow(self, request: httpx.Request):
        request.headers["Authorization"] = f"Bearer {await self._get_token()}"
        response = yield request
        if response.status_code == 401:
            # Token may have been revoked server-side — re-mint once and retry.
            request.headers["Authorization"] = (
                f"Bearer {await self._get_token(force=True)}"
            )
            yield request

    def sync_auth_flow(self, request: httpx.Request):
        raise RuntimeError("ClientCredentialsAuth is async-only")

    async def _get_token(self, force: bool = False) -> str:
        if self._lock is None:
            self._lock = asyncio.Lock()
        # Single-flight: concurrent requests share one mint.
        async with self._lock:
            if (
                not force
                and self._access_token
                and time.monotonic() < self._expires_at - REFRESH_THRESHOLD_SECONDS
            ):
                return self._access_token
            return await self._mint()

    async def _mint(self) -> str:
        data = {"grant_type": "client_credentials"}
        if self._scope:
            data["scope"] = self._scope
        basic = None
        if self._client_auth == "basic":
            basic = httpx.BasicAuth(self._client_id, self._client_secret)
        else:
            data["client_id"] = self._client_id
            data["client_secret"] = self._client_secret
        async with self._client_factory() as client:
            resp = await client.post(
                self._token_endpoint,
                data=data,
                auth=basic,
                timeout=TOKEN_REQUEST_TIMEOUT,
            )
        if resp.status_code >= 400:
            raise ClientCredentialsError(_map_error(resp, self._scope))
        try:
            payload = resp.json()
        except Exception as e:
            raise ClientCredentialsError(
                "Token endpoint returned a non-JSON response."
            ) from e
        token = payload.get("access_token")
        if not token:
            raise ClientCredentialsError("Token endpoint returned no access_token")
        ttl = float(payload.get("expires_in") or DEFAULT_MINT_TTL_SECONDS)
        self._access_token = token
        self._expires_at = time.monotonic() + ttl
        return token
