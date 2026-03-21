from __future__ import annotations

from fastapi import APIRouter, HTTPException

from backend.models import ResourceReadRequest
from backend import mcp_manager

router = APIRouter()


@router.get("/resources")
async def list_resources():
    if not mcp_manager.is_connected():
        raise HTTPException(status_code=400, detail="Not connected")
    try:
        items = await mcp_manager.list_resources()
        # FastMCP Client returns list directly
        if not isinstance(items, list):
            items = getattr(items, "resources", [items])
        resources = []
        for r in items:
            resources.append({
                "uri": str(getattr(r, "uri", "")),
                "name": getattr(r, "name", None),
                "description": getattr(r, "description", None),
                "mimeType": getattr(r, "mimeType", None),
            })
        return {"resources": resources}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/resources/read")
async def read_resource(req: ResourceReadRequest):
    if not mcp_manager.is_connected():
        raise HTTPException(status_code=400, detail="Not connected")
    try:
        result = await mcp_manager.read_resource(req.uri)
        # Result might be string, list, or object with .contents
        if isinstance(result, str):
            return {"contents": [{"text": result}]}
        if isinstance(result, list):
            return {"contents": [{"text": str(r)} for r in result]}
        contents = []
        for c in getattr(result, "contents", [result]):
            if isinstance(c, str):
                contents.append({"text": c})
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
    if not mcp_manager.is_connected():
        raise HTTPException(status_code=400, detail="Not connected")
    try:
        items = await mcp_manager.list_resource_templates()
        if not isinstance(items, list):
            items = getattr(items, "resource_templates", [items])
        templates = []
        for t in items:
            templates.append({
                "uriTemplate": str(getattr(t, "uriTemplate", "")),
                "name": getattr(t, "name", None),
                "description": getattr(t, "description", None),
            })
        return {"resourceTemplates": templates}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
