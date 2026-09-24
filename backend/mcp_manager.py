"""MCP connection manager for mcperiscope.

Uses FastMCP Client with WebOAuth for web-native OAuth flow.
The redirect URI points to the mcperiscope frontend.
"""

from __future__ import annotations

import asyncio
import logging
import os
from pathlib import Path
from typing import Any

from fastmcp import Client
from mcp.types import Tool
from backend.mcp_optimizer.inventory import analyze_inventory, analysis_to_dict
from backend.mcp_optimizer.proxy_runtime import StaticHeaderAuth
from backend.mcp_optimizer.token_store import FileKeyValueStore

from backend.auth.client_credentials import ClientCredentialsAuth
from backend.auth.oauth import WebOAuth
from backend.state import session
from backend.models import AuthConfig

logger = logging.getLogger(__name__)

TOKEN_DIR = Path.home() / ".mcperiscope" / "tokens"

# Global state
_client: Client | None = None
_auth: WebOAuth | None = None
_url: str | None = None
_tools: list[Tool] | None = None
_auth_config: AuthConfig | None = None
# Background task running _do_connect; outlives connect() when OAuth is needed.
_connect_task: asyncio.Task | None = None


def _make_transport(url: str, protocol: str | None):
    """Return the Client target honoring the requested protocol.

    - auto (default): let FastMCP infer the transport from the URL.
    - http: force Streamable HTTP.
    - sse: force the legacy HTTP+SSE transport.
    """
    if protocol == "http":
        from fastmcp.client.transports import StreamableHttpTransport

        return StreamableHttpTransport(url)
    if protocol == "sse":
        from fastmcp.client.transports import SSETransport

        return SSETransport(url)
    return url


def _build_client(
    url: str,
    oauth_provider: WebOAuth,
    auth_config: AuthConfig | None,
    protocol: str | None = None,
):
    """Build a FastMCP Client honoring the requested auth_config.

    - oauth (default): use the WebOAuth provider so the user can complete the
      browser flow.
    - oauth_client_creds: mint tokens with the user's own client ID/secret.
    - bearer: send `Authorization: Bearer <token>` on every request, no OAuth.
    - header: send `<name>: <value>` on every request, no OAuth.
    - none: no auth at all.
    """
    if auth_config is None:
        auth_type = "oauth"
    else:
        auth_type = (auth_config.type or "oauth").lower()

    target = _make_transport(url, protocol)

    if auth_type == "bearer":
        token = (auth_config.token if auth_config else None) or ""
        if not token:
            raise ValueError("bearer auth requested but no token supplied")
        return Client(target, auth=StaticHeaderAuth("Authorization", f"Bearer {token}"))
    if auth_type == "header":
        name = (auth_config.name if auth_config else None) or ""
        value = (auth_config.value if auth_config else None) or ""
        if not name:
            raise ValueError("header auth requested but no header name supplied")
        return Client(target, auth=StaticHeaderAuth(name, value))
    if auth_type == "oauth_client_creds":
        if not (
            auth_config
            and auth_config.token_endpoint
            and auth_config.client_id
            and auth_config.client_secret
        ):
            raise ValueError(
                "client-credentials auth requires token_endpoint, client_id, "
                "and client_secret"
            )
        return Client(
            target,
            auth=ClientCredentialsAuth(
                token_endpoint=auth_config.token_endpoint,
                client_id=auth_config.client_id,
                client_secret=auth_config.client_secret,
                scope=auth_config.scope,
                client_auth=auth_config.client_auth or "post",
            ),
        )
    if auth_type == "none":
        return Client(target)
    # oauth (default)
    return Client(target, auth=oauth_provider)


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


async def connect(
    url: str,
    auth_config: AuthConfig | None = None,
    protocol: str | None = None,
) -> dict:
    """Connect to an MCP server."""
    global _client, _auth, _url, _tools, _auth_config, _connect_task

    await disconnect()

    _url = url
    _auth_config = auth_config
    redirect_url = _get_redirect_url()

    oauth_kwargs: dict[str, Any] = {}
    if auth_config and (auth_config.type or "oauth") == "oauth":
        oauth_kwargs = dict(
            scopes=auth_config.scope,
            client_id=auth_config.client_id,
            client_secret=auth_config.client_secret,
            client_metadata_url=auth_config.client_metadata_url,
        )
        if auth_config.client_secret and auth_config.client_auth == "basic":
            oauth_kwargs["additional_client_metadata"] = {
                "token_endpoint_auth_method": "client_secret_basic"
            }

    _auth = WebOAuth(
        redirect_url=redirect_url,
        client_name="MCPeriscope",
        token_storage=FileKeyValueStore(TOKEN_DIR),
        **oauth_kwargs,
    )

    _client = _build_client(url, _auth, auth_config, protocol)

    # Try connecting — if OAuth is needed, HeadlessOAuth captures the auth URL
    connect_task = asyncio.create_task(_do_connect(_client))
    connect_task.add_done_callback(_log_connect_failure)
    _connect_task = connect_task

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


async def _do_connect(client: Client):
    """Internal connect that enters the client context."""
    global _tools
    await client.__aenter__()
    tools = await client.list_tools()
    if client is _client:  # ignore a stale task from a replaced connection
        _tools = tools


def _log_connect_failure(task: asyncio.Task) -> None:
    """Retrieve and log a background connect failure.

    Without this, a task that fails after connect() returned an OAuth
    redirect logs "Task exception was never retrieved".
    """
    if task.cancelled():
        return
    exc = task.exception()
    if exc is not None:
        logger.warning("MCP connect failed: %s", exc, exc_info=exc)


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
    task = _connect_task
    for _ in range(300):
        if task is not None and task.done():
            await task  # Re-raise the real connect error, if any
            return await _finish_connect()
        if _tools is not None:
            return await _finish_connect()
        await asyncio.sleep(0.1)

    raise TimeoutError("OAuth connection timed out")


async def disconnect() -> dict:
    """Disconnect from the MCP server."""
    global _client, _auth, _url, _tools, _auth_config, _connect_task

    task, _connect_task = _connect_task, None
    if task is not None and not task.done():
        task.cancel()
        await asyncio.wait([task])
    if _client is not None:
        try:
            await _client.__aexit__(None, None, None)
        except Exception:
            logger.debug("Error closing MCP client connection", exc_info=True)
    _client = None
    _auth = None
    _url = None
    _tools = None
    _auth_config = None
    session.reset()
    return {"status": "disconnected"}


async def signout(url: str) -> dict:
    """Delete stored OAuth tokens for a server, revoking upstream best-effort.

    The local delete always wins: revocation failures only downgrade the
    `revoked` field, they never block the sign-out.
    """
    from fastmcp.client.auth.oauth import TokenStorageAdapter

    from backend.auth.revocation import try_revoke

    normalized = url.rstrip("/")  # matches WebOAuth._bind's storage keying

    if _url and _url.rstrip("/") == normalized:
        # Never keep a live client whose tokens we are deleting.
        await disconnect()

    adapter = TokenStorageAdapter(
        async_key_value=FileKeyValueStore(TOKEN_DIR), server_url=normalized
    )
    tokens = await adapter.get_tokens()
    client_info = await adapter.get_client_info()
    revoked = await try_revoke(normalized, tokens, client_info)
    await adapter.clear()
    return {"status": "signed_out", "url": normalized, "revoked": revoked}


def is_connected() -> bool:
    return _client is not None and _tools is not None


def get_url() -> str | None:
    """Get the connected MCP server URL."""
    return _url


def get_auth_config() -> AuthConfig | None:
    """Get the auth config used for the current connection."""
    return _auth_config


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
    if not session.quick_wins:
        session.quick_wins = generate_quick_wins(session.tools, session.model)
    return {
        "status": "connected",
        "serverInfo": server_info(),
        "inventory": session.inventory,
    }
