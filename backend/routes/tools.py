from __future__ import annotations

import time

from fastapi import APIRouter, HTTPException

from backend.models import ToolCallRequest
from backend import mcp_manager
from backend.routes._common import _make_trace_event, _require_connected
from backend.state import session

router = APIRouter()


@router.get("/tools")
async def list_tools():
    _require_connected()
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
    _require_connected()
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
        is_error = bool(getattr(result, "isError", False))
        error = (result_text or "Tool returned an error") if is_error else None
        # Manual calls number their steps from 1, like each agent loop does.
        manual_step = 1 + sum(1 for t in session.traces if t.get("prompt_index") is None)
        session.traces.append(_make_trace_event(
            manual_step, start, req.name, req.arguments, result_text, duration, error,
        ))

        return {"content": content, "isError": is_error}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

