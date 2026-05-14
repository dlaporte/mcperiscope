from __future__ import annotations

import logging
import os

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.models import ResourceReadRequest
from backend import mcp_manager
from backend.state import session

logger = logging.getLogger(__name__)

router = APIRouter()


def _max_per_resource_bytes() -> int:
    raw = os.environ.get("MCPERISCOPE_MAX_RESOURCE_BYTES", "1048576")  # 1 MiB
    try:
        return max(1, int(raw))
    except ValueError:
        return 1_048_576


def _max_total_loaded_bytes() -> int:
    raw = os.environ.get("MCPERISCOPE_MAX_TOTAL_LOADED_BYTES", "10485760")  # 10 MiB
    try:
        return max(1, int(raw))
    except ValueError:
        return 10_485_760


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


def _guard_size(text: str | None, label: str) -> None:
    if not text:
        return
    cap = _max_per_resource_bytes()
    if len(text.encode("utf-8", errors="ignore")) > cap:
        raise HTTPException(
            status_code=413,
            detail=(
                f"{label} exceeds the per-resource limit ({cap} bytes). "
                "Override with MCPERISCOPE_MAX_RESOURCE_BYTES."
            ),
        )


@router.post("/resources/read")
async def read_resource(req: ResourceReadRequest):
    if not mcp_manager.is_connected():
        raise HTTPException(status_code=400, detail="Not connected")
    try:
        result = await mcp_manager.read_resource(req.uri)
        # Result might be string, list, or object with .contents
        if isinstance(result, str):
            _guard_size(result, f"resource {req.uri}")
            return {"contents": [{"text": result}]}
        if isinstance(result, list):
            contents = []
            for r in result:
                if isinstance(r, str):
                    _guard_size(r, f"resource {req.uri}")
                    contents.append({"text": r})
                else:
                    text = getattr(r, "text", None)
                    _guard_size(text, f"resource {req.uri}")
                    contents.append({
                        "uri": str(getattr(r, "uri", "")),
                        "text": text,
                        "mimeType": getattr(r, "mimeType", None),
                        "blob": getattr(r, "blob", None),
                    })
            return {"contents": contents}
        contents = []
        for c in getattr(result, "contents", [result]):
            if isinstance(c, str):
                _guard_size(c, f"resource {req.uri}")
                contents.append({"text": c})
            else:
                text = getattr(c, "text", None)
                _guard_size(text, f"resource {req.uri}")
                contents.append({
                    "uri": str(getattr(c, "uri", "")),
                    "text": text,
                    "mimeType": getattr(c, "mimeType", None),
                    "blob": getattr(c, "blob", None),
                })
        return {"contents": contents}
    except HTTPException:
        raise
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
    """Load a resource into the evaluation context.

    Enforces caps so a malicious / verbose MCP server can't blow up the
    process memory or the LLM context budget.
    """
    if not mcp_manager.is_connected():
        raise HTTPException(status_code=400, detail="Not connected")
    per_cap = _max_per_resource_bytes()
    total_cap = _max_total_loaded_bytes()
    try:
        result = await mcp_manager.read_resource(req.uri)
        text = _extract_text(result)
        if len(text.encode("utf-8", errors="ignore")) > per_cap:
            raise HTTPException(
                status_code=413,
                detail=(
                    f"Resource {req.uri} exceeds the per-resource limit "
                    f"({per_cap} bytes). Override with MCPERISCOPE_MAX_RESOURCE_BYTES."
                ),
            )
        already_loaded = sum(
            len(r.get("content", "").encode("utf-8", errors="ignore"))
            for uri, r in session.loaded_resources.items()
            if uri != req.uri
        )
        new_size = len(text.encode("utf-8", errors="ignore"))
        if already_loaded + new_size > total_cap:
            raise HTTPException(
                status_code=413,
                detail=(
                    f"Loading {req.uri} would exceed the total loaded-resource "
                    f"limit ({total_cap} bytes). Unload some resources first or "
                    "override with MCPERISCOPE_MAX_TOTAL_LOADED_BYTES."
                ),
            )
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
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


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
