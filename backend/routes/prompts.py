from __future__ import annotations

from fastapi import APIRouter, HTTPException

from backend.models import PromptGetRequest
from backend import mcp_manager

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
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


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
        raise HTTPException(status_code=500, detail=str(e))
