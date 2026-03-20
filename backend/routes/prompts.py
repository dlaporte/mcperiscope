from __future__ import annotations

from fastapi import APIRouter, HTTPException

from backend.models import PromptGetRequest
from backend.state import session

router = APIRouter()


@router.get("/prompts")
async def list_prompts():
    if not session.connection or not session.connection.connected:
        raise HTTPException(status_code=400, detail="Not connected")
    try:
        result = await session.connection._client.list_prompts()
        # FastMCP Client returns list[Prompt] directly
        items = result if isinstance(result, list) else getattr(result, "prompts", [])
        prompts = []
        for p in items:
            prompts.append({
                "name": p.name,
                "description": p.description,
                "arguments": [
                    {
                        "name": a.name,
                        "description": a.description,
                        "required": a.required,
                    }
                    for a in (p.arguments or [])
                ],
            })
        return {"prompts": prompts}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/prompts/get")
async def get_prompt(req: PromptGetRequest):
    if not session.connection or not session.connection.connected:
        raise HTTPException(status_code=400, detail="Not connected")
    try:
        result = await session.connection._client.get_prompt(req.name, req.arguments)
        messages = []
        for m in result.messages:
            content_block = m.content
            if hasattr(content_block, "text"):
                messages.append({
                    "role": m.role,
                    "content": {"type": "text", "text": content_block.text},
                })
            else:
                messages.append({
                    "role": m.role,
                    "content": str(content_block),
                })
        return {"messages": messages, "description": result.description}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
