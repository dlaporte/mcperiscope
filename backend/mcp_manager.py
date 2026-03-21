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

from fastmcp import Client
from mcp.types import Tool
from mcp_optimizer.inventory import analyze_inventory, analysis_to_dict
from mcp_optimizer.token_store import FileKeyValueStore

from backend.auth.oauth import WebOAuth
from backend.state import session
from backend.models import AuthConfig

logger = logging.getLogger(__name__)

# Global state
_client: Client | None = None
_auth: WebOAuth | None = None
_url: str | None = None
_tools: list[Tool] | None = None


def _get_redirect_url(request_origin: str | None = None) -> str:
    env_url = os.environ.get("OAUTH_REDIRECT_URL")
    if env_url:
        return env_url
    if request_origin:
        return f"{request_origin.rstrip('/')}/oauth/callback"
    return "http://localhost:5173/oauth/callback"


async def connect(url: str, auth_config: AuthConfig | None = None, request_origin: str | None = None) -> dict:
    """Connect to an MCP server."""
    global _client, _auth, _url, _tools

    await disconnect()

    _url = url
    redirect_url = _get_redirect_url(request_origin)
    token_dir = Path.home() / ".mcperiscope" / "tokens"

    _auth = WebOAuth(
        redirect_url=redirect_url,
        client_name="MCPeriscope",
        token_storage=FileKeyValueStore(token_dir),
    )

    _client = Client(url, auth=_auth)

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
    """Complete OAuth by providing the callback URL or bare code from the frontend."""
    global _tools

    if not _auth:
        raise ValueError("No OAuth flow in progress")

    # Handle both full URL and bare code
    from urllib.parse import urlparse, parse_qs, urlencode

    if "://" in callback_url_or_code and "code=" in callback_url_or_code:
        # Full callback URL — use as-is
        _auth.supply_callback_url(callback_url_or_code)
    else:
        # Bare code (or URL without code param) — construct a callback URL
        # Extract state from the pending auth URL if available
        state = None
        if _auth.pending_auth_url:
            parsed_auth = urlparse(_auth.pending_auth_url)
            auth_params = parse_qs(parsed_auth.query)
            state = auth_params.get("state", [None])[0]

        # Build a synthetic callback URL
        code = callback_url_or_code.strip()
        params = {"code": code}
        if state:
            params["state"] = state
        synthetic_url = f"http://localhost/callback?{urlencode(params)}"
        _auth.supply_callback_url(synthetic_url)

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
            pass
    _client = None
    _auth = None
    _url = None
    _tools = None
    session.connection = None
    session.reset()
    return {"status": "disconnected"}


def is_connected() -> bool:
    return _client is not None and _tools is not None


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
    session.quick_wins = generate_quick_wins(session.tools, total_tokens, session.model)
    return {
        "status": "connected",
        "serverInfo": server_info(),
        "inventory": session.inventory,
    }
