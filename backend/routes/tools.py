from __future__ import annotations

import time

from fastapi import APIRouter, HTTPException

from backend.models import ToolCallRequest
from backend import mcp_manager
from backend.routes._common import _make_trace_event
from backend.state import session

router = APIRouter()


@router.get("/tools")
async def list_tools():
    if not session.tools:
        raise HTTPException(status_code=400, detail="Not connected")
    tools = []
    for t in session.tools:
        tools.append({
            "name": t.name,
            "description": t.description,
            "inputSchema": t.inputSchema,
        })
    return {"tools": tools}


@router.post("/tools/call")
async def call_tool(req: ToolCallRequest):
    if not mcp_manager.is_connected():
        raise HTTPException(status_code=400, detail="Not connected")
    try:
        start = time.time()
        result = await mcp_manager.call_tool(req.name, req.arguments)
        duration = time.time() - start

        content = []
        if hasattr(result, "content"):
            for block in result.content:
                if hasattr(block, "text"):
                    content.append({"type": "text", "text": block.text})
                elif hasattr(block, "data"):
                    content.append({"type": "image", "data": block.data, "mimeType": getattr(block, "mimeType", "image/png")})
                else:
                    content.append({"type": "unknown", "value": str(block)})
        else:
            content.append({"type": "text", "text": str(result)})

        result_text = "\n".join(c["text"] for c in content if c["type"] == "text")
        session.traces.append(_make_trace_event(
            len(session.traces), start, req.name, req.arguments, result_text, duration,
        ))

        return {"content": content, "isError": getattr(result, "isError", False)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

