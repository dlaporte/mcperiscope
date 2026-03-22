from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Request

from backend.models import ConnectRequest
from backend import mcp_manager
from backend.state import session

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
    if req.model:
        session.model = req.model
    if req.provider:
        session.provider = req.provider
    if req.api_key:
        session.api_key = req.api_key
    if req.custom_endpoint:
        session.custom_endpoint = req.custom_endpoint
    # Only validate API key for Anthropic provider
    if req.api_key and (req.provider or session.provider) == "anthropic":
        await _validate_api_key(req.api_key)
    if req.custom_context_window:
        session.custom_context_window = req.custom_context_window
    try:
        # Pass the request origin so OAuth redirect goes to the right host
        origin = request.headers.get("origin")
        return await mcp_manager.connect(req.url, req.auth, request_origin=origin)
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
