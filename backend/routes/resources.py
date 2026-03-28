from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException
from mcp.shared.exceptions import McpError
from pydantic import BaseModel

from backend.models import ResourceReadRequest
from backend import mcp_manager
from backend.state import session

logger = logging.getLogger(__name__)

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
    except McpError as e:
        if "Method not found" in str(e):
            return {"resources": []}
        logger.exception("Error in resources route")
        raise HTTPException(status_code=500, detail="Internal server error")
    except Exception as e:
        logger.exception("Error in resources route")
        raise HTTPException(status_code=500, detail="Internal server error")


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
            contents = []
            for r in result:
                if isinstance(r, str):
                    contents.append({"text": r})
                else:
                    contents.append({
                        "uri": str(getattr(r, "uri", "")),
                        "text": getattr(r, "text", None),
                        "mimeType": getattr(r, "mimeType", None),
                        "blob": getattr(r, "blob", None),
                    })
            return {"contents": contents}
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
        logger.exception("Error in resources route")
        raise HTTPException(status_code=500, detail="Internal server error")


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
    except McpError as e:
        if "Method not found" in str(e):
            return {"resourceTemplates": []}
        logger.exception("Error in resources route")
        raise HTTPException(status_code=500, detail="Internal server error")
    except Exception as e:
        logger.exception("Error in resources route")
        raise HTTPException(status_code=500, detail="Internal server error")


class LoadResourceRequest(BaseModel):
    uri: str


def _extract_text(result) -> str:
    """Extract text content from an MCP read_resource result."""
    if isinstance(result, str):
        return result
    if isinstance(result, list):
        parts = []
        for r in result:
            if isinstance(r, str):
                parts.append(r)
            else:
                parts.append(getattr(r, "text", "") or "")
        return "\n\n".join(parts)
    parts = []
    for c in getattr(result, "contents", [result]):
        if isinstance(c, str):
            parts.append(c)
        else:
            parts.append(getattr(c, "text", "") or "")
    return "\n\n".join(parts)


@router.post("/resources/load")
async def load_resource(req: LoadResourceRequest):
    """Load a resource into the evaluation context."""
    if not mcp_manager.is_connected():
        raise HTTPException(status_code=400, detail="Not connected")
    try:
        result = await mcp_manager.read_resource(req.uri)
        text = _extract_text(result)
        name = req.uri.split("/")[-1] if "/" in req.uri else req.uri
        # Try to find the resource name from the listed resources
        try:
            resources = await mcp_manager.list_resources()
            items = resources if isinstance(resources, list) else getattr(resources, "resources", [])
            for r in items:
                if str(getattr(r, "uri", "")) == req.uri:
                    name = getattr(r, "name", name) or name
                    break
        except Exception:
            logger.debug("Failed to look up resource name from listing", exc_info=True)

        entry = {
            "name": name,
            "content": text,
            "tokens": max(1, len(text) // 4),
        }
        session.loaded_resources[req.uri] = entry
        return {"loaded": True, **entry, "uri": req.uri}
    except Exception as e:
        logger.exception("Error in resources route")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/resources/unload")
async def unload_resource(req: LoadResourceRequest):
    """Remove a resource from the evaluation context."""
    session.loaded_resources.pop(req.uri, None)
    return {"loaded": False, "uri": req.uri}


@router.get("/resources/loaded")
async def get_loaded_resources():
    """Get all currently loaded resources."""
    return {
        "resources": [
            {"uri": uri, "name": r["name"], "tokens": r["tokens"]}
            for uri, r in session.loaded_resources.items()
        ]
    }
