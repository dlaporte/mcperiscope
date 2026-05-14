"""MCP connection manager for mcperiscope.

Uses FastMCP Client with WebOAuth for web-native OAuth flow.
The redirect URI points to the mcperiscope frontend.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from pathlib import Path
from typing import Any

import httpx
from fastmcp import Client
from mcp.types import Tool
from backend.mcp_optimizer.inventory import analyze_inventory, analysis_to_dict
from backend.mcp_optimizer.token_store import FileKeyValueStore

from backend.auth.oauth import WebOAuth
from backend.state import session
from backend.models import AuthConfig

logger = logging.getLogger(__name__)

# Global state
_client: Client | None = None
_auth: WebOAuth | None = None
_url: str | None = None
_tools: list[Tool] | None = None


class _StaticHeaderAuth(httpx.Auth):
    """Inject a fixed header on every request — used for bearer/custom-header MCP auth."""

    def __init__(self, header_name: str, header_value: str) -> None:
        self._header_name = header_name
        self._header_value = header_value

    def auth_flow(self, request):
        request.headers[self._header_name] = self._header_value
        yield request


def _build_client(url: str, oauth_provider: WebOAuth, auth_config: AuthConfig | None):
    """Build a FastMCP Client honoring the requested auth_config.

    - oauth (default): use the WebOAuth provider so the user can complete the
      browser flow.
    - bearer: send `Authorization: Bearer <token>` on every request, no OAuth.
    - header: send `<name>: <value>` on every request, no OAuth.
    - none: no auth at all.
    """
    if auth_config is None:
        auth_type = "oauth"
    else:
        auth_type = (auth_config.type or "oauth").lower()

    if auth_type == "bearer":
        token = (auth_config.token if auth_config else None) or ""
        if not token:
            raise ValueError("bearer auth requested but no token supplied")
        return Client(url, auth=_StaticHeaderAuth("Authorization", f"Bearer {token}"))
    if auth_type == "header":
        name = (auth_config.name if auth_config else None) or ""
        value = (auth_config.value if auth_config else None) or ""
        if not name:
            raise ValueError("header auth requested but no header name supplied")
        return Client(url, auth=_StaticHeaderAuth(name, value))
    if auth_type == "none":
        return Client(url)
    # oauth (default)
    return Client(url, auth=oauth_provider)


def _get_redirect_url() -> str:
    """Return the OAuth redirect URL.

    Pulled exclusively from `OAUTH_REDIRECT_URL` (preferred) or the safe
    default `http://localhost:5173/oauth/callback`. We deliberately do NOT
    accept the request's `Origin` header — that's attacker-controllable on
    direct HTTP calls and was the SEC-05 surface.
    """
    env_url = os.environ.get("OAUTH_REDIRECT_URL")
    if env_url:
        return env_url
    return "http://localhost:5173/oauth/callback"


async def connect(url: str, auth_config: AuthConfig | None = None) -> dict:
    """Connect to an MCP server."""
    global _client, _auth, _url, _tools

    await disconnect()

    _url = url
    redirect_url = _get_redirect_url()
    token_dir = Path.home() / ".mcperiscope" / "tokens"

    _auth = WebOAuth(
        redirect_url=redirect_url,
        client_name="MCPeriscope",
        token_storage=FileKeyValueStore(token_dir),
    )

    _client = _build_client(url, _auth, auth_config)

    # Try connecting — if OAuth is needed, HeadlessOAuth captures the auth URL
    connect_task = asyncio.create_task(_do_connect())

    # Wait for either connection success or OAuth redirect
    for _ in range(50):
        if connect_task.done():
            await connect_task  # Re-raise exceptions
            return await _finish_connect()
        if _auth.pending_auth_url:
            return {
                "status": "oauth_redirect",
                "authorizationUrl": _auth.pending_auth_url,
            }
        await asyncio.sleep(0.1)

    # Still connecting — check one more time
    if _auth.pending_auth_url:
        return {
            "status": "oauth_redirect",
            "authorizationUrl": _auth.pending_auth_url,
        }

    # Wait for completion
    await connect_task
    return await _finish_connect()


async def _do_connect():
    """Internal connect that enters the client context."""
    global _tools
    await _client.__aenter__()
    _tools = await _client.list_tools()


async def complete_oauth(callback_url_or_code: str) -> dict:
    """Complete OAuth by providing the full callback URL from the browser.

    The full URL contains the `state` value the OAuth library generated. We
    require it so the underlying provider can compare the returned state to
    the one it issued. The previous "bare code + synthetic state" path
    forged the state on the caller's behalf, defeating that check.
    """
    global _tools

    if not _auth:
        raise ValueError("No OAuth flow in progress")

    from urllib.parse import parse_qs, urlparse

    parsed = urlparse(callback_url_or_code)
    has_url = bool(parsed.scheme and parsed.netloc)
    query = parse_qs(parsed.query) if has_url else {}
    if not (has_url and query.get("code") and query.get("state")):
        raise ValueError(
            "OAuth completion requires the full callback URL "
            "(including both `code` and `state` query parameters)."
        )

    _auth.supply_callback_url(callback_url_or_code)

    # Wait for the connection to complete
    for _ in range(300):
        if _tools is not None:
            return await _finish_connect()
        await asyncio.sleep(0.1)

    raise TimeoutError("OAuth connection timed out")


async def disconnect() -> dict:
    """Disconnect from the MCP server."""
    global _client, _auth, _url, _tools

    if _client is not None:
        try:
            await _client.__aexit__(None, None, None)
        except Exception:
            logger.debug("Error closing MCP client connection", exc_info=True)
    _client = None
    _auth = None
    _url = None
    _tools = None
    session.connection = None
    session.reset()
    return {"status": "disconnected"}


def is_connected() -> bool:
    return _client is not None and _tools is not None


def get_url() -> str | None:
    """Get the connected MCP server URL."""
    return _url


def is_oauth_pending() -> bool:
    """Check if an OAuth flow is awaiting callback."""
    return _auth is not None and _auth.pending_auth_url is not None and not is_connected()


def get_oauth_url() -> str | None:
    """Get the pending OAuth authorization URL."""
    return _auth.pending_auth_url if _auth else None


def server_info() -> dict | None:
    if not is_connected():
        return None
    return {"url": _url, "toolCount": len(session.tools)}


async def call_tool(name: str, arguments: dict[str, Any] | None = None) -> Any:
    """Call a tool on the connected MCP server."""
    if not _client:
        raise RuntimeError("Not connected")
    return await _client.call_tool(name, arguments or {})


async def list_resources():
    if not _client:
        raise RuntimeError("Not connected")
    return await _client.list_resources()


async def list_resource_templates():
    if not _client:
        raise RuntimeError("Not connected")
    return await _client.list_resource_templates()


async def read_resource(uri: str):
    if not _client:
        raise RuntimeError("Not connected")
    return await _client.read_resource(uri)


async def list_prompts():
    if not _client:
        raise RuntimeError("Not connected")
    return await _client.list_prompts()


async def get_prompt(name: str, arguments: dict[str, str] | None = None):
    if not _client:
        raise RuntimeError("Not connected")
    return await _client.get_prompt(name, arguments)


async def _finish_connect() -> dict:
    """Shared logic after successful connection."""
    from backend.routes.analysis import generate_quick_wins

    session.tools = _tools or []
    inventory = analyze_inventory(session.tools)
    session.inventory = analysis_to_dict(inventory)
    total_tokens = session.inventory.get("total_budget_tokens", 0)
    if not session.quick_wins:
        session.quick_wins = generate_quick_wins(session.tools, total_tokens, session.model)
    return {
        "status": "connected",
        "serverInfo": server_info(),
        "inventory": session.inventory,
    }
