from __future__ import annotations

import json
import time
import traceback

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from backend.models import EvaluateRequest, RatingRequest
from backend.state import session

router = APIRouter()


def _serialize_mcp_result(result) -> str:
    """Convert MCP CallToolResult to a plain text string."""
    parts = []
    if hasattr(result, "content"):
        for block in result.content:
            if hasattr(block, "text"):
                parts.append(block.text)
            elif hasattr(block, "data"):
                parts.append(f"[binary data: {getattr(block, 'mimeType', 'unknown')}]")
            else:
                parts.append(str(block))
    else:
        parts.append(str(result))
    return "\n".join(parts)


def _extract_fields(text: str) -> list[str]:
    """Extract top-level JSON keys from text."""
    try:
        data = json.loads(text)
        if isinstance(data, dict):
            return list(data.keys())
        elif isinstance(data, list) and data and isinstance(data[0], dict):
            return list(data[0].keys())
    except (json.JSONDecodeError, IndexError, TypeError):
        pass
    return []


@router.post("/optimize/evaluate")
async def evaluate(req: EvaluateRequest):
    """Run an evaluation prompt with SSE streaming of tool calls."""
    if not session.connection:
        raise HTTPException(status_code=400, detail="Not connected")
    if not session.api_key:
        raise HTTPException(status_code=400, detail="Anthropic API key not configured")
    if not session.tools:
        raise HTTPException(status_code=400, detail="No tools available")

    async def event_stream():
        import anthropic

        try:
            client = anthropic.Anthropic(api_key=session.api_key)
        except Exception as e:
            yield _sse_event("error", {"message": f"Failed to initialize Anthropic client: {e}"})
            return

        # Convert MCP tools to Anthropic tool format
        tools = []
        for t in session.tools:
            tools.append({
                "name": t.name,
                "description": t.description or "",
                "input_schema": t.inputSchema or {"type": "object", "properties": {}},
            })

        messages = [{"role": "user", "content": req.prompt}]
        tool_chain: list[dict] = []
        trace_events: list[dict] = []
        step = 0
        final_answer = ""

        try:
            while True:
                # Send "thinking" event so frontend knows LLM is working
                yield _sse_event("thinking", {"step": step})

                response = client.messages.create(
                    model=session.model,
                    max_tokens=4096,
                    tools=tools,
                    messages=messages,
                )

                tool_use_blocks = [b for b in response.content if b.type == "tool_use"]
                text_blocks = [b for b in response.content if b.type == "text"]

                if not tool_use_blocks:
                    final_answer = "\n".join(b.text for b in text_blocks)
                    break

                # Add assistant message
                messages.append({
                    "role": "assistant",
                    "content": [_block_to_dict(b) for b in response.content],
                })

                # Execute each tool call and stream results
                tool_results = []
                for tool_use in tool_use_blocks:
                    step += 1
                    start = time.time()
                    error = None
                    result_text = ""

                    # Send "calling" event before the call
                    yield _sse_event("tool_calling", {
                        "step": step,
                        "tool": tool_use.name,
                        "input": tool_use.input,
                    })

                    try:
                        result = await session.connection.call_tool(
                            tool_use.name, tool_use.input
                        )
                        result_text = _serialize_mcp_result(result)
                    except Exception as e:
                        error = str(e)
                        result_text = f"Error: {error}"

                    duration = time.time() - start

                    tool_step = {
                        "step": step,
                        "tool": tool_use.name,
                        "input": tool_use.input,
                        "output": result_text,
                        "duration": round(duration, 3),
                        "error": error,
                    }
                    tool_chain.append(tool_step)

                    # Send "tool_result" event after the call completes
                    yield _sse_event("tool_result", tool_step)

                    # Build trace event
                    trace_event = {
                        "step": len(session.traces) + len(trace_events),
                        "timestamp": start,
                        "tool_name": tool_use.name,
                        "tool_input": tool_use.input,
                        "tool_response_chars": len(result_text),
                        "tool_response_tokens_est": max(1, len(result_text) // 4),
                        "tool_response_fields": _extract_fields(result_text),
                        "tool_duration_s": round(duration, 3),
                        "error_category": error if error else None,
                    }
                    trace_events.append(trace_event)

                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": tool_use.id,
                        "content": result_text,
                    })

                messages.append({"role": "user", "content": tool_results})

        except Exception as e:
            final_answer = f"Evaluation error: {e}\n{traceback.format_exc()}"

        # Store results in session
        eval_result = {
            "prompt": req.prompt,
            "answer": final_answer,
            "toolChain": tool_chain,
            "traceEvents": trace_events,
        }
        session.eval_results.append(eval_result)
        session.traces.extend(trace_events)
        session.prompts.append(req.prompt)

        # Send final "done" event with full result
        yield _sse_event("done", {
            "prompt": req.prompt,
            "answer": final_answer,
            "toolChain": tool_chain,
            "traceEvents": trace_events,
            "index": len(session.eval_results) - 1,
        })

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def _sse_event(event_type: str, data: dict) -> str:
    """Format a Server-Sent Event."""
    return f"event: {event_type}\ndata: {json.dumps(data)}\n\n"


@router.post("/optimize/rate")
async def rate(req: RatingRequest):
    if req.prompt_index < 0 or req.prompt_index >= len(session.eval_results):
        raise HTTPException(status_code=400, detail="Invalid prompt index")

    session.eval_results[req.prompt_index]["rating"] = {
        "correctness": req.correctness,
        "notes": req.notes,
    }

    rating_entry = {
        "prompt_index": req.prompt_index,
        "prompt": session.eval_results[req.prompt_index]["prompt"],
        "correctness": req.correctness,
        "notes": req.notes,
    }
    while len(session.ratings) <= req.prompt_index:
        session.ratings.append(None)
    session.ratings[req.prompt_index] = rating_entry

    rated = [r for r in session.ratings if r is not None]
    correct = sum(1 for r in rated if r["correctness"] == "correct")
    partial = sum(1 for r in rated if r["correctness"] == "partial")
    wrong = sum(1 for r in rated if r["correctness"] == "wrong")
    total_scored = correct + partial + wrong
    accuracy = (correct + 0.5 * partial) / total_scored if total_scored > 0 else 0

    return {
        "accuracy": round(accuracy, 3),
        "correct": correct,
        "partial": partial,
        "wrong": wrong,
        "total": len(rated),
    }


@router.post("/optimize/run")
async def run_optimize():
    if not session.connection:
        raise HTTPException(status_code=400, detail="Not connected")

    rated = [r for r in session.ratings if r is not None]
    if not rated:
        raise HTTPException(status_code=400, detail="No rated evaluations yet")

    try:
        from mcp_optimizer.analyze import run_analysis
        from mcp_optimizer.report import compute_comparison

        analysis_result = run_analysis(session.tools, session.traces, rated)
        session.analysis = analysis_result
        session.recommendations = analysis_result.get("recommendations", [])

        # Compute comparison metrics
        try:
            comparison = compute_comparison(
                baseline_traces=session.traces,
                baseline_ratings=rated,
                proxy_traces=[],
                proxy_ratings=[],
                original_tools=session.tools,
                proxy_tool_count=0,
            )
            session.comparison = comparison
        except Exception:
            session.comparison = None

        return {
            "status": "complete",
            "recommendationCount": len(session.recommendations),
            "accuracy": round(
                sum(1 for r in rated if r["correctness"] == "correct") / len(rated), 3
            ) if rated else 0,
        }
    except ImportError as e:
        raise HTTPException(
            status_code=500,
            detail=f"mcp-optimizer dependency not available: {e}",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Optimization failed: {e}")


def _block_to_dict(block) -> dict:
    """Convert an Anthropic content block to a serializable dict."""
    if block.type == "text":
        return {"type": "text", "text": block.text}
    elif block.type == "tool_use":
        return {
            "type": "tool_use",
            "id": block.id,
            "name": block.name,
            "input": block.input,
        }
    else:
        return {"type": block.type}
