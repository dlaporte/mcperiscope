from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Request

from backend.models import AuthConfig, ConnectRequest
from backend import mcp_manager
from backend.credentials import bind_primary_credentials
from backend.state import session
from backend.url_validation import validate_external_url

logger = logging.getLogger(__name__)

router = APIRouter()


async def _validate_api_key(api_key: str) -> None:
    """Validate the Anthropic API key by making a lightweight API call."""
    if not api_key:
        return
    import anthropic
    try:
        client = anthropic.AsyncAnthropic(api_key=api_key)
        await client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=1,
            messages=[{"role": "user", "content": "hi"}],
        )
    except anthropic.AuthenticationError:
        raise HTTPException(status_code=400, detail="Invalid Anthropic API key")
    except Exception:
        logger.debug("Non-auth error during API key validation (key is likely valid)", exc_info=True)


async def validate_primary_key(api_key: str | None, provider: str | None) -> None:
    """Validate a primary key that is about to be bound, before binding it.

    Only Anthropic keys are checked. `provider=None` means the caller keeps
    the session's current provider (see bind_primary_credentials).
    """
    effective_provider = session.provider if provider is None else provider.strip()
    if api_key and api_key.strip() and effective_provider == "anthropic":
        await _validate_api_key(api_key.strip())


def _validate_auth_config(auth: AuthConfig | None) -> None:
    """Reject malformed auth configs with a 400 before any connection attempt."""
    if auth is None:
        return
    if auth.type == "oauth_client_creds":
        if not (auth.token_endpoint and auth.client_id and auth.client_secret):
            raise HTTPException(
                status_code=400,
                detail=(
                    "Client-credentials auth requires token endpoint, "
                    "client ID, and client secret"
                ),
            )
        validate_external_url(auth.token_endpoint, label="Token endpoint")
    if auth.type == "oauth" and auth.client_metadata_url:
        # The MCP SDK hard-requires an HTTPS, non-root-path CIMD URL; fail
        # with a 400 here instead of its ValueError surfacing as a 500.
        validate_external_url(auth.client_metadata_url, label="Client metadata URL")
        from urllib.parse import urlparse

        parsed = urlparse(auth.client_metadata_url)
        if parsed.scheme != "https" or parsed.path in ("", "/"):
            raise HTTPException(
                status_code=400,
                detail=(
                    "Client metadata URL must be an HTTPS URL with a "
                    "non-root path (e.g. https://example.com/oauth/client.json)"
                ),
            )


@router.post("/connect")
async def connect(req: ConnectRequest, request: Request):
    # Validate the upstream MCP URL before touching session state.
    validate_external_url(req.url, label="MCP server URL")
    if req.custom_endpoint:
        validate_external_url(req.custom_endpoint, label="LLM endpoint")
    _validate_auth_config(req.auth)

    # Validate first so an invalid key is never stored.
    await validate_primary_key(req.api_key, req.provider)
    bind_primary_credentials(
        session,
        api_key=req.api_key,
        provider=req.provider,
        custom_endpoint=req.custom_endpoint,
        model=req.model,
    )
    if req.custom_context_window:
        session.custom_context_window = req.custom_context_window
    try:
        return await mcp_manager.connect(req.url, req.auth, req.protocol)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/disconnect")
async def disconnect():
    return await mcp_manager.disconnect()


@router.get("/status")
async def status():
    return {
        "connected": mcp_manager.is_connected(),
        "serverInfo": mcp_manager.server_info(),
        "oauthPending": (
            mcp_manager.is_oauth_pending()
        ),
    }
