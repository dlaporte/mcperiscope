from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from backend.models import OAuthCallbackRequest
from backend import mcp_manager
from backend.state import session
from mcp_optimizer.inventory import analyze_inventory, analysis_to_dict

router = APIRouter()


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


@router.post("/auth/callback")
async def auth_callback(req: OAuthCallbackRequest):
    if req.model:
        session.model = req.model

    async def event_stream():
        # Step 1: Validate API key
        if req.api_key:
            yield _sse("progress", {"message": "Validating API key..."})
            try:
                from backend.routes.connection import _validate_api_key
                await _validate_api_key(req.api_key)
                session.api_key = req.api_key
            except HTTPException as e:
                yield _sse("error", {"message": e.detail})
                return

        # Step 2: Exchange OAuth code for tokens
        yield _sse("progress", {"message": "Exchanging authorization code..."})
        try:
            if not session.connection:
                yield _sse("error", {"message": "No connection in progress"})
                return
            session.connection.supply_callback_url(req.callback_url)
        except Exception as e:
            yield _sse("error", {"message": f"OAuth code exchange failed: {e}"})
            return

        # Step 3: Complete connection (this does the MCP handshake)
        yield _sse("progress", {"message": "Connecting to MCP server..."})
        try:
            tools = await session.connection.complete_connect(timeout=30)
        except Exception as e:
            yield _sse("error", {"message": f"Connection failed: {e}"})
            return

        # Step 4: List tools
        yield _sse("progress", {"message": f"Discovered {len(tools)} tools, analyzing..."})
        session.tools = tools

        # Step 5: Run inventory analysis
        yield _sse("progress", {"message": "Analyzing tool inventory..."})
        inventory = analyze_inventory(tools)
        session.inventory = analysis_to_dict(inventory)

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
        "oauthPending": (
            session.connection is not None
            and session.connection.pending_auth_url is not None
            and not session.connection.connected
        ),
    }
