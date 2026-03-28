from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException
from mcp.shared.exceptions import McpError

from backend.models import PromptGetRequest
from backend import mcp_manager

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/prompts")
async def list_prompts():
    if not mcp_manager.is_connected():
        raise HTTPException(status_code=400, detail="Not connected")
    try:
        items = await mcp_manager.list_prompts()
        prompts = []
        for p in items:
            prompts.append({
                "name": p.name,
                "description": p.description,
                "arguments": [
                    {"name": a.name, "description": a.description, "required": a.required}
                    for a in (p.arguments or [])
                ],
            })
        return {"prompts": prompts}
    except McpError as e:
        if "Method not found" in str(e):
            return {"prompts": []}
        logger.exception("Error in prompts route")
        raise HTTPException(status_code=500, detail="Internal server error")
    except Exception as e:
        logger.exception("Error in prompts route")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/prompts/get")
async def get_prompt(req: PromptGetRequest):
    if not mcp_manager.is_connected():
        raise HTTPException(status_code=400, detail="Not connected")
    try:
        result = await mcp_manager.get_prompt(req.name, req.arguments)
        messages = []
        for m in result.messages:
            content_block = m.content
            if hasattr(content_block, "text"):
                messages.append({"role": m.role, "content": {"type": "text", "text": content_block.text}})
            else:
                messages.append({"role": m.role, "content": str(content_block)})
        return {"messages": messages, "description": result.description}
    except Exception as e:
        logger.exception("Error in prompts route")
        raise HTTPException(status_code=500, detail="Internal server error")
