from __future__ import annotations

import logging
import os

from fastapi import APIRouter, HTTPException

from backend.models import ResourceReadRequest
from backend import mcp_manager
from backend.mcp_optimizer.inventory import estimate_tokens
from backend.routes._common import _require_connected
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
    _require_connected()
    try:
        resources = []
        for r in await mcp_manager.list_resources():
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
    _require_connected()
    try:
        result = await mcp_manager.read_resource(req.uri)
        contents = []
        for c in mcp_manager.resource_contents(result):
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


@router.post("/resources/load")
async def load_resource(req: ResourceReadRequest):
    """Load a resource into the evaluation context.

    Enforces caps so a malicious / verbose MCP server can't blow up the
    process memory or the LLM context budget.
    """
    _require_connected()
    total_cap = _max_total_loaded_bytes()
    try:
        result = await mcp_manager.read_resource(req.uri)
        text = mcp_manager.extract_resource_text(result)
        _guard_size(text, f"Resource {req.uri}")
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
            for r in await mcp_manager.list_resources():
                if str(getattr(r, "uri", "")) == req.uri:
                    name = getattr(r, "name", name) or name
                    break
        except Exception:
            logger.debug("Failed to look up resource name from listing", exc_info=True)

        entry = {
            "name": name,
            "content": text,
            "tokens": estimate_tokens(text),
        }
        session.loaded_resources[req.uri] = entry
        return {"loaded": True, **entry, "uri": req.uri}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/resources/unload")
async def unload_resource(req: ResourceReadRequest):
    """Remove a resource from the evaluation context."""
    session.loaded_resources.pop(req.uri, None)
    return {"loaded": False, "uri": req.uri}
