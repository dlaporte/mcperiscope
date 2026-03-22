from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from backend.models import OAuthCallbackRequest
from backend import mcp_manager
from backend.state import session

router = APIRouter()


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


@router.post("/auth/callback")
async def auth_callback(req: OAuthCallbackRequest):
    if req.model:
        session.model = req.model

    async def event_stream():
        # Step 1: Store API key
        if req.api_key:
            session.api_key = req.api_key
            # Validate only for Anthropic models (not custom endpoints)
            if not session.custom_endpoint and session.model.startswith("claude-"):
                from backend.routes.connection import _validate_api_key
                try:
                    await _validate_api_key(req.api_key)
                except HTTPException as e:
                    yield _sse("error", {"message": e.detail})
                    return

        # Step 2: Exchange OAuth code and reconnect
        yield _sse("progress", {"message": "Exchanging authorization code..."})
        try:
            # The callback_url might be a full URL or just the code
            callback = req.callback_url
            yield _sse("progress", {"message": "Connecting to MCP server..."})
            result = await mcp_manager.complete_oauth(callback)
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


@router.get("/auth/status")
async def auth_status():
    return {
        "connected": mcp_manager.is_connected(),
        "oauthPending": mcp_manager.is_oauth_pending(),
    }
