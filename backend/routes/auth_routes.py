from fastapi import APIRouter, HTTPException
from backend.models import OAuthCallbackRequest
from backend import mcp_manager

router = APIRouter()


@router.post("/auth/callback")
async def auth_callback(req: OAuthCallbackRequest):
    from backend.state import session
    if req.model:
        session.model = req.model
    if req.api_key:
        from backend.routes.connection import _validate_api_key
        await _validate_api_key(req.api_key)
        session.api_key = req.api_key
    try:
        return await mcp_manager.complete_oauth(req.callback_url)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/auth/status")
async def auth_status():
    from backend.state import session
    return {
        "connected": mcp_manager.is_connected(),
        "oauthPending": (
            session.connection is not None
            and session.connection.pending_auth_url is not None
            and not session.connection.connected
        ),
    }
