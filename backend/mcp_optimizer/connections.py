"""MCP connection manager using FastMCP's Client with OAuth support.

Provides ``MCPConnection``, a persistent connection to a target MCP server
that handles OAuth authentication and exposes tool listing / calling.

Supports headless OAuth: if no browser is available, the authorization URL
is captured and the auth code can be supplied manually.
"""

from __future__ import annotations

import hashlib
import logging
import secrets
import string
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlencode, urlparse

import anyio
import httpx
from fastmcp import Client
from fastmcp.client.auth import OAuth
from mcp.client.auth import OAuthClientProvider, TokenStorage
from mcp.shared.auth import (
    OAuthClientInformationFull,
    OAuthClientMetadata,
    OAuthMetadata,
    OAuthToken,
)
from mcp.types import Tool

from backend.mcp_optimizer.token_store import FileKeyValueStore

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


# ---------------------------------------------------------------------------
# Connection manager
# ---------------------------------------------------------------------------

class MCPConnection:
    """Manages a persistent connection to a target MCP server.

    Usage::

        conn = MCPConnection("https://example.com/mcp")
        tools = await conn.connect()
        result = await conn.call_tool("my_tool", {"arg": "value"})
        await conn.disconnect()

    Or as an async context manager::

        async with MCPConnection("https://example.com/mcp") as conn:
            tools = conn.tools
            result = await conn.call_tool("my_tool", {"arg": "value"})

    Headless OAuth flow::

        conn = MCPConnection("https://example.com/mcp")
        try:
            tools = await conn.connect()
        except OAuthPending as e:
            # Present e.auth_url to the user
            # After they authenticate, get the callback URL and:
            conn.supply_callback_url("http://localhost:.../callback?code=...&state=...")
            tools = await conn.complete_connect()
    """

    def __init__(self, url: str, token_dir: Path | None = None) -> None:
        self.url = url
        self._token_dir = token_dir or Path.home() / ".mcp-optimizer" / "tokens"
        self._client: Client | None = None
        self._tools: list[Tool] | None = None
        self._auth: HeadlessOAuth | None = None

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def connect(self) -> list[Tool]:
        """Connect to the MCP server and return its tool definitions.

        If OAuth is required and no cached tokens are available, the
        connection will still be established but the OAuth flow will be
        triggered. On a headless system, this may raise an error or
        the auth URL can be retrieved from ``pending_auth_url``.
        """
        store = FileKeyValueStore(self._token_dir)
        self._auth = HeadlessOAuth(
            client_name="mcp-optimizer",
            token_storage=store,
            callback_port=18329,  # Fixed port for consistent redirect_uri registration
        )
        self._client = Client(self.url, auth=self._auth)
        await self._client.__aenter__()
        self._tools = await self._client.list_tools()
        logger.info(
            "Connected to %s — discovered %d tool(s)", self.url, len(self._tools)
        )
        return self._tools

    async def connect_with_auth_url(self) -> tuple[list[Tool] | None, str | None]:
        """Connect, returning (tools, auth_url).

        If connection succeeds immediately (cached tokens), returns (tools, None).
        If OAuth is needed, starts the flow in the background and returns
        (None, auth_url). Call supply_callback_url() then complete_connect().
        """
        import asyncio

        store = FileKeyValueStore(self._token_dir)
        self._auth = HeadlessOAuth(
            client_name="mcp-optimizer",
            token_storage=store,
            callback_port=18329,  # Fixed port for consistent redirect_uri registration
        )
        self._client = Client(self.url, auth=self._auth)

        # Try connecting — if OAuth is needed, the HeadlessOAuth will capture
        # the auth URL and wait for the code. We run the connect in a task
        # and check if an auth URL appears.
        connect_task = asyncio.create_task(self._do_connect())

        # Give it a moment to either succeed or trigger OAuth
        for _ in range(50):  # Up to 5 seconds
            if connect_task.done():
                # Connection completed (cached tokens or no auth needed)
                await connect_task  # Re-raise any exceptions
                return self._tools, None
            if self._auth.pending_auth_url:
                # OAuth triggered — return the URL
                return None, self._auth.pending_auth_url
            await asyncio.sleep(0.1)

        # Still connecting after 5s — likely OAuth in progress
        if self._auth.pending_auth_url:
            return None, self._auth.pending_auth_url

        # Wait for the task to complete
        await connect_task
        return self._tools, None

    async def _do_connect(self) -> None:
        """Internal: perform the actual connection."""
        await self._client.__aenter__()
        self._tools = await self._client.list_tools()
        logger.info(
            "Connected to %s — discovered %d tool(s)", self.url, len(self._tools)
        )

    def supply_callback_url(self, callback_url: str) -> None:
        """Supply the OAuth callback URL to complete headless authentication."""
        if not self._auth:
            raise RuntimeError("No OAuth flow in progress")
        self._auth.supply_callback_url(callback_url)

    async def complete_connect(self, timeout: float = 30) -> list[Tool]:
        """Wait for the OAuth flow to complete after supplying the callback URL."""
        import asyncio

        # The connect task should complete now that we've supplied the code
        for _ in range(int(timeout * 10)):
            if self._tools is not None:
                return self._tools
            await asyncio.sleep(0.1)

        raise TimeoutError("Connection did not complete after supplying OAuth code")

    async def disconnect(self) -> None:
        """Close the connection to the MCP server."""
        if self._client is not None:
            await self._client.__aexit__(None, None, None)
            self._client = None
            logger.info("Disconnected from %s", self.url)

    # ------------------------------------------------------------------
    # Tool operations
    # ------------------------------------------------------------------

    async def call_tool(self, name: str, arguments: dict[str, Any] | None = None) -> Any:
        """Call a tool on the target MCP server."""
        if self._client is None:
            raise RuntimeError("Not connected — call connect() first")
        return await self._client.call_tool(name, arguments or {})

    # ------------------------------------------------------------------
    # Properties
    # ------------------------------------------------------------------

    @property
    def tools(self) -> list[Tool]:
        """Tool definitions discovered during connect()."""
        if self._tools is None:
            raise RuntimeError("Not connected — call connect() first")
        return self._tools

    @property
    def connected(self) -> bool:
        """Whether the connection is currently open."""
        return self._client is not None and self._tools is not None

    @property
    def pending_auth_url(self) -> str | None:
        """If OAuth is pending, the URL the user needs to visit."""
        if self._auth:
            return self._auth.pending_auth_url
        return None

    # ------------------------------------------------------------------
    # Async context manager
    # ------------------------------------------------------------------

    async def __aenter__(self) -> MCPConnection:
        await self.connect()
        return self

    async def __aexit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        await self.disconnect()
