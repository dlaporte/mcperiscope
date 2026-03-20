from __future__ import annotations
import json
import logging
from typing import Any

from mcp_optimizer.connections import MCPConnection
from mcp_optimizer.inventory import analyze_inventory, analysis_to_dict
from backend.state import session
from backend.models import AuthConfig

logger = logging.getLogger(__name__)


async def connect(url: str, auth_config: AuthConfig | None = None) -> dict:
    """Connect to an MCP server. Returns status dict."""
    if session.connection:
        await session.connection.disconnect()
    session.reset()

    session.connection = MCPConnection(url)

    # TODO: For bearer/header auth, extend MCPConnection to accept custom headers
    # For now, OAuth and no-auth are supported

    tools, auth_url = await session.connection.connect_with_auth_url()

    if auth_url:
        return {
            "status": "oauth_redirect",
            "authorizationUrl": auth_url,
        }

    return _finish_connect(tools)


async def complete_oauth(callback_url: str) -> dict:
    """Complete OAuth by providing the callback URL."""
    if not session.connection:
        raise ValueError("No connection in progress")
    session.connection.supply_callback_url(callback_url)
    tools = await session.connection.complete_connect(timeout=30)
    return _finish_connect(tools)


async def disconnect() -> dict:
    """Disconnect from the MCP server."""
    if session.connection:
        await session.connection.disconnect()
        session.connection = None
    session.reset()
    return {"status": "disconnected"}


def is_connected() -> bool:
    return session.connection is not None and session.connection.connected


def server_info() -> dict | None:
    # MCPConnection doesn't expose server info directly
    # Return basic info
    if not is_connected():
        return None
    return {"url": session.connection.url, "toolCount": len(session.tools)}


def _finish_connect(tools) -> dict:
    """Shared logic after successful connection."""
    session.tools = tools
    inventory = analyze_inventory(tools)
    session.inventory = analysis_to_dict(inventory)
    return {
        "status": "connected",
        "serverInfo": server_info(),
        "inventory": session.inventory,
    }
