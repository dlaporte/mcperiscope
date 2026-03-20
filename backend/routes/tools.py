from __future__ import annotations

import json
import time

from fastapi import APIRouter, HTTPException

from backend.models import ToolCallRequest
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
    if not session.connection:
        raise HTTPException(status_code=400, detail="Not connected")
    try:
        start = time.time()
        result = await session.connection.call_tool(req.name, req.arguments)
        duration = time.time() - start

        # Serialize MCP result
        content = []
        if hasattr(result, "content"):
            for block in result.content:
                if hasattr(block, "text"):
                    content.append({"type": "text", "text": block.text})
                elif hasattr(block, "data"):
                    content.append({
                        "type": "image",
                        "data": block.data,
                        "mimeType": getattr(block, "mimeType", "image/png"),
                    })
                else:
                    content.append({"type": "unknown", "value": str(block)})
        else:
            content.append({"type": "text", "text": str(result)})

        # Capture trace event for optimize tab
        trace_event = {
            "step": len(session.traces),
            "timestamp": start,
            "tool_name": req.name,
            "tool_input": req.arguments,
            "tool_response_chars": sum(len(c.get("text", "")) for c in content),
            "tool_response_tokens_est": max(1, sum(len(c.get("text", "")) for c in content) // 4),
            "tool_response_fields": _extract_fields(content),
            "tool_duration_s": round(duration, 3),
            "error_category": None,
        }
        session.traces.append(trace_event)

        return {"content": content, "isError": getattr(result, "isError", False)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


def _extract_fields(content: list[dict]) -> list[str]:
    """Extract top-level JSON keys from text content."""
    for c in content:
        if c.get("type") == "text":
            try:
                data = json.loads(c["text"])
                if isinstance(data, dict):
                    return list(data.keys())
                elif isinstance(data, list) and data and isinstance(data[0], dict):
                    return list(data[0].keys())
            except (json.JSONDecodeError, IndexError):
                pass
    return []
