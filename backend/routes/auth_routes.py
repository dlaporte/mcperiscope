from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from backend.models import OAuthCallbackRequest, SignOutRequest
from backend import mcp_manager
from backend.credentials import bind_primary_credentials
from backend.routes._common import _sse
from backend.routes.connection import validate_primary_key
from backend.state import session
from backend.url_validation import validate_external_url

router = APIRouter()


@router.post("/auth/callback")
async def auth_callback(req: OAuthCallbackRequest):
    if req.custom_endpoint:
        validate_external_url(req.custom_endpoint, label="LLM endpoint")

    async def event_stream():
        # Step 1: Validate, then store, the API key (same rules as /connect)
        try:
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
        except HTTPException as e:
            yield _sse("error", {"message": e.detail})
            return

        # Step 2: Exchange OAuth code and reconnect
        yield _sse("progress", {"message": "Exchanging authorization code and connecting..."})
        try:
            # complete_oauth requires the full callback URL (code + state)
            await mcp_manager.complete_oauth(req.callback_url)
        except Exception as e:
            yield _sse("error", {"message": f"OAuth completion failed: {e}"})
            return

        yield _sse("progress", {"message": f"Discovered {len(session.tools)} tools, analyzing..."})

        # Done
        yield _sse("done", {
            "status": "connected",
            "serverInfo": mcp_manager.server_info(),
            "inventory": session.inventory,
        })

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/auth/signout")
async def auth_signout(req: SignOutRequest):
    """Delete stored OAuth tokens for a server (best-effort upstream revoke)."""
    validate_external_url(req.url, label="MCP server URL")
    try:
        return await mcp_manager.signout(req.url)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Sign-out failed: {e}")
