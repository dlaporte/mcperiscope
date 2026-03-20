from __future__ import annotations

from fastapi import APIRouter, HTTPException

from backend.models import ResourceReadRequest
from backend.state import session

router = APIRouter()


@router.get("/resources")
async def list_resources():
    if not session.connection or not session.connection.connected:
        raise HTTPException(status_code=400, detail="Not connected")
    try:
        result = await session.connection._client.list_resources()
        # FastMCP Client returns list[Resource] directly
        items = result if isinstance(result, list) else getattr(result, "resources", [])
        resources = []
        for r in items:
            resources.append({
                "uri": str(getattr(r, "uri", r.get("uri", "")) if isinstance(r, dict) else r.uri),
                "name": getattr(r, "name", None) if not isinstance(r, dict) else r.get("name"),
                "description": getattr(r, "description", None) if not isinstance(r, dict) else r.get("description"),
                "mimeType": getattr(r, "mimeType", None) if not isinstance(r, dict) else r.get("mimeType"),
            })
        return {"resources": resources}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/resources/read")
async def read_resource(req: ResourceReadRequest):
    if not session.connection or not session.connection.connected:
        raise HTTPException(status_code=400, detail="Not connected")
    try:
        result = await session.connection._client.read_resource(req.uri)
        # Result might be list of content blocks or object with .contents
        items = result if isinstance(result, list) else getattr(result, "contents", [result])
        contents = []
        for c in items:
            if isinstance(c, dict):
                contents.append(c)
            else:
                contents.append({
                    "uri": str(getattr(c, "uri", "")),
                    "text": getattr(c, "text", None),
                    "mimeType": getattr(c, "mimeType", None),
                    "blob": getattr(c, "blob", None),
                })
        return {"contents": contents}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/resource-templates")
async def list_resource_templates():
    if not session.connection or not session.connection.connected:
        raise HTTPException(status_code=400, detail="Not connected")
    try:
        result = await session.connection._client.list_resource_templates()
        items = result if isinstance(result, list) else getattr(result, "resource_templates", [])
        templates = []
        for t in items:
            if isinstance(t, dict):
                templates.append(t)
            else:
                templates.append({
                    "uriTemplate": str(getattr(t, "uriTemplate", "")),
                    "name": getattr(t, "name", None),
                    "description": getattr(t, "description", None),
                })
        return {"resourceTemplates": templates}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
