"""Headless OAuth provider for FastMCP's Client.

Provides ``HeadlessOAuth``: if no browser is available, the authorization URL
is captured and the auth code can be supplied manually.
"""

from __future__ import annotations

import logging
from typing import Any
from urllib.parse import parse_qs, urlparse

import anyio
from fastmcp.client.auth import OAuth

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Headless OAuth provider
# ---------------------------------------------------------------------------

class HeadlessOAuth(OAuth):
    """OAuth provider that supports headless environments.

    Instead of opening a browser and running a localhost callback server,
    it captures the authorization URL and waits for the auth code to be
    supplied programmatically via ``supply_auth_code()``.
    """

    def __init__(self, **kwargs: Any) -> None:
        self._pending_auth_url: str | None = None
        self._auth_code: str | None = None
        self._auth_state: str | None = None
        self._code_event: anyio.Event | None = None
        # Without a pre-registered client secret, MCPeriscope is a public client
        # that authenticates with PKCE, so it must register as a public client.
        # If we let the server pick the default token_endpoint_auth_method it may
        # choose client_secret_basic and issue a secret; the MCP SDK then sends
        # both an Authorization: Basic header AND client_id in the token-request
        # body, which strict servers reject with "Client must not use multiple
        # authentication methods". Forcing "none" keeps the token exchange to a
        # single (public/PKCE) auth method. With a client_secret the confidential
        # default (client_secret_post, or an explicit override) applies instead.
        acm = dict(kwargs.pop("additional_client_metadata", None) or {})
        if not kwargs.get("client_secret"):
            acm.setdefault("token_endpoint_auth_method", "none")
        kwargs["additional_client_metadata"] = acm
        super().__init__(**kwargs)

    @property
    def pending_auth_url(self) -> str | None:
        """The authorization URL the user needs to visit, if auth is pending."""
        return self._pending_auth_url

    def supply_callback_url(self, callback_url: str) -> None:
        """Supply the full callback URL from the browser's address bar.

        The URL looks like:
        http://localhost:PORT/callback?code=AUTH_CODE&state=STATE
        """
        parsed = urlparse(callback_url)
        params = parse_qs(parsed.query)
        code = params.get("code", [None])[0]
        state = params.get("state", [None])[0]
        if not code:
            raise ValueError(f"No 'code' parameter found in URL: {callback_url}")
        self._auth_code = code
        self._auth_state = state
        if self._code_event:
            self._code_event.set()

    async def redirect_handler(self, authorization_url: str) -> None:
        """Capture the auth URL instead of opening a browser."""
        self._pending_auth_url = authorization_url
        self._code_event = anyio.Event()
        logger.info("OAuth authorization required: %s", authorization_url)
        # Don't open browser — the caller will retrieve the URL and present it

    async def callback_handler(self) -> tuple[str, str | None]:
        """Wait for the auth code to be supplied via supply_callback_url()."""
        if self._auth_code:
            # Already supplied
            code = self._auth_code
            state = self._auth_state
            self._auth_code = None
            self._auth_state = None
            return code, state

        # Wait for supply_callback_url() to be called
        if self._code_event is None:
            self._code_event = anyio.Event()

        with anyio.fail_after(300):  # 5 minute timeout
            await self._code_event.wait()

        code = self._auth_code
        state = self._auth_state
        self._auth_code = None
        self._auth_state = None
        if not code:
            raise RuntimeError("OAuth callback received but no auth code was set")
        return code, state
