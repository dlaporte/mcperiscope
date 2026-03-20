from __future__ import annotations

import json
import time
import traceback

from fastapi import APIRouter, HTTPException

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
    if not session.connection:
        raise HTTPException(status_code=400, detail="Not connected")
    if not session.api_key:
        raise HTTPException(status_code=400, detail="Anthropic API key not configured")
    if not session.tools:
        raise HTTPException(status_code=400, detail="No tools available")

    try:
        import anthropic

        client = anthropic.Anthropic(api_key=session.api_key)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to initialize Anthropic client: {e}")

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

    try:
        while True:
            response = client.messages.create(
                model=session.model,
                max_tokens=4096,
                tools=tools,
                messages=messages,
            )

            tool_use_blocks = [b for b in response.content if b.type == "tool_use"]
            text_blocks = [b for b in response.content if b.type == "text"]

            if not tool_use_blocks:
                # Done - extract final answer
                final_answer = "\n".join(b.text for b in text_blocks)
                break

            # Add assistant message with all content blocks
            messages.append({
                "role": "assistant",
                "content": [_block_to_dict(b) for b in response.content],
            })

            # Execute each tool call
            tool_results = []
            for tool_use in tool_use_blocks:
                step += 1
                start = time.time()
                error = None
                result_text = ""

                try:
                    result = await session.connection.call_tool(
                        tool_use.name, tool_use.input
                    )
                    result_text = _serialize_mcp_result(result)
                except Exception as e:
                    error = str(e)
                    result_text = f"Error: {error}"

                duration = time.time() - start

                # Build tool chain step
                tool_chain.append({
                    "step": step,
                    "tool": tool_use.name,
                    "input": tool_use.input,
                    "output": result_text,
                    "duration": round(duration, 3),
                    "error": error,
                })

                # Build trace event (mcp-optimizer compatible)
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
        # If the agentic loop itself fails, return what we have
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

    return {
        "prompt": req.prompt,
        "answer": final_answer,
        "toolChain": tool_chain,
        "traceEvents": trace_events,
        "index": len(session.eval_results) - 1,
    }


@router.post("/optimize/rate")
async def rate(req: RatingRequest):
    if req.prompt_index < 0 or req.prompt_index >= len(session.eval_results):
        raise HTTPException(status_code=400, detail="Invalid prompt index")

    # Store rating on the eval result
    session.eval_results[req.prompt_index]["rating"] = {
        "correctness": req.correctness,
        "notes": req.notes,
    }

    # Store in ratings list (mcp-optimizer compatible format)
    rating_entry = {
        "prompt": session.eval_results[req.prompt_index]["prompt"],
        "correctness": req.correctness,
        "notes": req.notes,
    }
    # Replace existing rating for this index if present
    while len(session.ratings) <= req.prompt_index:
        session.ratings.append(None)
    session.ratings[req.prompt_index] = rating_entry

    # Compute accuracy
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
        from mcp_optimizer.proxy_generator import generate_proxy_code
        from mcp_optimizer.report import compute_comparison

        # Run analysis
        tools_dicts = [
            {
                "name": t.name,
                "description": t.description or "",
                "inputSchema": t.inputSchema or {"type": "object", "properties": {}},
            }
            for t in session.tools
        ]

        analysis_result = run_analysis(tools_dicts, session.traces, rated)
        session.analysis = analysis_result
        session.recommendations = analysis_result.get("recommendations", [])

        # Generate proxy code if there are consolidation recommendations
        proxy_code = None
        consolidation_recs = [
            r for r in session.recommendations
            if r.get("type") == "consolidation" and r.get("tools") and r.get("merged_name")
        ]
        if consolidation_recs:
            try:
                proxy_code = generate_proxy_code(
                    tools=tools_dicts,
                    recommendations=session.recommendations,
                )
                session.proxy_code = proxy_code
            except Exception:
                # Proxy generation is optional
                pass

        # Compute comparison metrics
        try:
            comparison = compute_comparison(
                tools=tools_dicts,
                recommendations=session.recommendations,
                traces=session.traces,
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
