from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Request

from backend.models import ConnectRequest
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
        client = anthropic.Anthropic(api_key=api_key)
        client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=1,
            messages=[{"role": "user", "content": "hi"}],
        )
    except anthropic.AuthenticationError:
        raise HTTPException(status_code=400, detail="Invalid Anthropic API key")
    except Exception:
        logger.debug("Non-auth error during API key validation (key is likely valid)", exc_info=True)


@router.post("/connect")
async def connect(req: ConnectRequest, request: Request):
    # Validate the upstream MCP URL before touching session state.
    validate_external_url(req.url, label="MCP server URL")
    if req.custom_endpoint:
        validate_external_url(req.custom_endpoint, label="LLM endpoint")

    bind_primary_credentials(
        session,
        api_key=req.api_key,
        provider=req.provider,
        custom_endpoint=req.custom_endpoint,
        model=req.model,
    )

    # Only validate API key for Anthropic provider
    if req.api_key and session.provider == "anthropic":
        await _validate_api_key(req.api_key)
    if req.custom_context_window:
        session.custom_context_window = req.custom_context_window
    try:
        return await mcp_manager.connect(req.url, req.auth)
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
