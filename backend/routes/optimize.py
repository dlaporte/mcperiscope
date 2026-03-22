from __future__ import annotations

import json
import logging
import subprocess
import sys
import time
import traceback
import socket
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from pydantic import BaseModel
from backend.models import EvaluateRequest, RatingRequest
from backend.state import session
from backend import mcp_manager
from backend.llm_client import LLMClient

logger = logging.getLogger(__name__)

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
    if not mcp_manager.is_connected():
        raise HTTPException(status_code=400, detail="Not connected")
    # Always restore from request (backend may have restarted)
    if req.api_key:
        session.api_key = req.api_key
    if req.model:
        session.model = req.model
    if req.provider:
        session.provider = req.provider
    if req.custom_endpoint:
        session.custom_endpoint = req.custom_endpoint
    if not session.api_key:
        raise HTTPException(status_code=400, detail="API key not configured")
    if not session.tools:
        raise HTTPException(status_code=400, detail="No tools available")

    async def event_stream():
        try:
            client = LLMClient(session.api_key, session.model, session.provider, session.custom_endpoint)
        except Exception as e:
            yield _sse("error", {"message": f"Failed to initialize LLM client: {e}"})
            return

        tools = []
        for t in session.tools:
            tools.append({
                "name": t.name,
                "description": t.description or "",
                "input_schema": t.inputSchema or {"type": "object", "properties": {}},
            })

        # Build conversation history from previous evaluations
        # Include the FULL message history (tool calls + results) to mirror
        # real-world behavior where tool responses accumulate in context
        messages = []

        # Inject loaded resources as context at the start
        if session.loaded_resources:
            resource_parts = []
            for uri, res in session.loaded_resources.items():
                resource_parts.append(f"## {res['name']}\n\n{res['content']}")
            resource_context = (
                "The following resources have been loaded for reference:\n\n"
                + "\n\n---\n\n".join(resource_parts)
            )
            messages.append({"role": "user", "content": resource_context})
            messages.append({"role": "assistant", "content": "I've reviewed the loaded resources and will use them to help answer your questions."})

        for prev in session.eval_results:
            raw = prev.get("raw_messages")
            if raw:
                # Replay the full conversation including tool calls/results
                messages.extend(raw)
            elif prev.get("answer"):
                # Fallback: just prompt + answer (older evals without raw_messages)
                messages.append({"role": "user", "content": prev["prompt"]})
                messages.append({"role": "assistant", "content": prev["answer"]})
        messages.append({"role": "user", "content": req.prompt})
        this_eval_start = len(messages) - 1  # Index where this eval's messages begin
        tool_chain: list[dict] = []
        trace_events: list[dict] = []
        step = 0
        final_answer = ""
        total_input_tokens = 0
        total_output_tokens = 0
        peak_input_tokens = 0  # Last round's input_tokens = actual context window usage
        # Context tracking: use API-reported base + estimated delta from new content
        context_base = 0  # Last API-reported input_tokens (accurate)
        context_delta = 0  # Estimated tokens added since last API report
        max_rounds = req.max_tool_rounds or 20
        max_tokens = req.max_tokens or 4096
        round_num = 0

        try:
            while True:
                round_num += 1
                if round_num > max_rounds:
                    final_answer = f"[Stopped after {max_rounds} tool call rounds — increase limit in Settings]"
                    yield _sse("error", {"message": f"Max tool call rounds ({max_rounds}) exceeded"})
                    break
                yield _sse("thinking", {"step": step, "context_tokens": context_base + context_delta})

                # Stream the LLM response — yields text deltas then final LLMResponse
                response = None
                streamed_text_len = 0
                async for item in client.chat_stream(messages=messages, tools=tools, max_tokens=max_tokens):
                    if isinstance(item, str):
                        streamed_text_len += len(item)
                        yield _sse("text_delta", {"text": item, "context_tokens": context_base + context_delta + streamed_text_len // 4})
                    else:
                        # Final LLMResponse
                        response = item

                if response is None:
                    yield _sse("error", {"message": "No response from LLM"})
                    break

                # Replace estimate with API-reported value — this is authoritative
                total_input_tokens += response.input_tokens
                total_output_tokens += response.output_tokens
                peak_input_tokens = response.input_tokens
                if response.input_tokens > 0:
                    context_base = response.input_tokens
                    context_delta = 0  # Reset delta — base is now accurate
                    # Send corrected value so frontend can update
                    yield _sse("context_update", {"context_tokens": context_base, "source": "api"})

                if not response.tool_calls:
                    final_answer = response.text
                    break

                messages.append({
                    "role": "assistant",
                    "content": client.to_anthropic_blocks(response),
                })

                tool_results = []
                for tool_use in response.tool_calls:
                    step += 1
                    start = time.time()
                    error = None
                    result_text = ""

                    yield _sse("tool_calling", {
                        "step": step,
                        "tool": tool_use.name,
                        "input": tool_use.input,
                    })

                    try:
                        result = await mcp_manager.call_tool(
                            tool_use.name, tool_use.input
                        )
                        result_text = _serialize_mcp_result(result)
                    except Exception as e:
                        error = str(e)
                        result_text = f"Error: {error}"

                    duration = time.time() - start

                    # Update context delta estimate (~4 chars/token, standard BPE approximation)
                    input_str = json.dumps(tool_use.input)
                    context_delta += max(1, len(input_str) // 4) + max(1, len(result_text) // 4)

                    tool_step = {
                        "step": step,
                        "tool": tool_use.name,
                        "input": tool_use.input,
                        "output": result_text,
                        "duration": round(duration, 3),
                        "error": error,
                        "context_tokens": context_base + context_delta,
                    }
                    tool_chain.append(tool_step)

                    yield _sse("tool_result", tool_step)

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

        usage = {
            "input_tokens": total_input_tokens,
            "output_tokens": total_output_tokens,
            "total_tokens": total_input_tokens + total_output_tokens,
            "peak_context_tokens": peak_input_tokens,  # Actual context window usage (last round)
            "api_rounds": step + 1,  # Number of API calls made
        }

        # Capture the full context window contents for inspection
        # At this point, `messages` contains the complete conversation:
        # prior Q&A history + current prompt + all tool_use/tool_result rounds + final answer
        # Add the final answer to messages
        if final_answer:
            messages.append({"role": "assistant", "content": final_answer})

        # Extract this eval's messages (for replaying in future context)
        this_eval_messages = messages[this_eval_start:]
        full_messages = messages

        context_window = {
            "tools": [{"name": t["name"], "description": t["description"]} for t in tools],
            "tool_count": len(tools),
            "messages": [
                {
                    "role": m["role"],
                    "content": _serialize_message_content(m["content"]),
                }
                for m in full_messages
            ],
            "message_count": len(full_messages),
        }

        eval_result = {
            "prompt": req.prompt,
            "answer": final_answer,
            "toolChain": tool_chain,
            "traceEvents": trace_events,
            "usage": usage,
            "contextWindow": context_window,
            "raw_messages": this_eval_messages,
        }
        session.eval_results.append(eval_result)
        session.traces.extend(trace_events)
        session.prompts.append(req.prompt)

        # Don't include contextWindow in SSE — it's too large and breaks chunked parsing.
        # It's stored in session.eval_results and can be fetched via API.
        yield _sse("done", {
            "prompt": req.prompt,
            "answer": final_answer,
            "toolChain": tool_chain,
            "traceEvents": trace_events,
            "usage": usage,
            "index": len(session.eval_results) - 1,
        })

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/optimize/context/{index}")
async def get_context(index: int):
    """Get the context window data for a specific evaluation."""
    if index < 0 or index >= len(session.eval_results):
        raise HTTPException(status_code=404, detail="Evaluation not found")
    ctx = session.eval_results[index].get("contextWindow")
    if not ctx:
        raise HTTPException(status_code=404, detail="No context window data")
    return ctx


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


class OptimizeRunRequest(BaseModel):
    included_indices: list[int] | None = None
    api_key: str | None = None
    model: str | None = None
    provider: str | None = None
    custom_endpoint: str | None = None
    judge_model: str | None = None
    judge_provider: str | None = None
    judge_api_key: str | None = None
    judge_endpoint: str | None = None


@router.post("/optimize/run")
async def run_optimize(req: OptimizeRunRequest | None = None):
    """Full optimization pipeline with SSE progress streaming.

    Steps: analyze → generate proxy → start proxy → re-run prompts → compare → results
    """
    if not mcp_manager.is_connected():
        raise HTTPException(status_code=400, detail="Not connected")

    # Always restore API key/model/endpoint from request (backend may have restarted)
    if req and req.api_key:
        session.api_key = req.api_key
    if req and req.model:
        session.model = req.model
    if req and req.provider:
        session.provider = req.provider
    if req and req.custom_endpoint:
        session.custom_endpoint = req.custom_endpoint
    if req and req.judge_model:
        session.judge_model = req.judge_model
    if req and req.judge_provider:
        session.judge_provider = req.judge_provider
    if req and req.judge_api_key:
        session.judge_api_key = req.judge_api_key
    if req and req.judge_endpoint:
        session.judge_endpoint = req.judge_endpoint
    if not session.api_key:
        raise HTTPException(status_code=400, detail="API key not configured")

    # Kill any proxy left over from a previous run
    session.kill_proxy()

    # Filter to only included evaluations
    included = set(req.included_indices) if req and req.included_indices is not None else set(range(len(session.eval_results)))
    included_evals = [e for i, e in enumerate(session.eval_results) if i in included]
    if not included_evals:
        raise HTTPException(status_code=400, detail="No evaluations included")

    async def event_stream():
        import asyncio
        from backend.mcp_optimizer.analyze import run_analysis
        from backend.mcp_optimizer.inventory import analyze_inventory, analysis_to_dict
        from backend.mcp_optimizer.report import compute_comparison

        # --- Step 1: Analyze ---
        yield _sse("progress", {"phase": "analyze", "message": "Analyzing tool usage patterns..."})
        try:
            # Pass empty ratings — rating is no longer used
            analysis_result = run_analysis(session.tools, session.traces, [])
            session.analysis = analysis_result
            session.recommendations = analysis_result.get("recommendations", [])
        except Exception as e:
            yield _sse("error", {"message": f"Analysis failed: {e}"})
            return

        rec_count = len(session.recommendations)
        yield _sse("progress", {"phase": "analyze", "message": f"Found {rec_count} optimization recommendations"})

        if rec_count == 0:
            yield _sse("done", {
                "status": "complete",
                "recommendationCount": 0,
                "comparison": None,
                "message": "No optimizations found",
            })
            return

        # --- Step 2: Generate proxy ---
        yield _sse("progress", {"phase": "proxy", "message": "Generating optimized proxy server..."})
        proxy_code = None
        try:
            proxy_code = _generate_proxy_for_recommendations(
                session.recommendations, session.tools, mcp_manager.get_url() or ""
            )
            session.proxy_code = proxy_code
        except Exception as e:
            yield _sse("progress", {"phase": "proxy", "message": f"Proxy generation skipped: {e}"})

        # --- Step 3: Start proxy ---
        proxy_port = None
        proxy_process = None
        proxy_tools = None
        proxy_menu_tokens = 0
        if proxy_code:
            yield _sse("progress", {"phase": "proxy", "message": "Starting proxy server..."})
            try:
                proxy_port, proxy_process = _start_proxy(proxy_code)

                # Wait for proxy to start, check health
                for attempt in range(10):
                    await asyncio.sleep(1)
                    if proxy_process.poll() is not None:
                        break  # Process died
                    try:
                        import httpx
                        async with httpx.AsyncClient() as hc:
                            resp = await hc.post(
                                f"http://localhost:{proxy_port}/mcp",
                                json={"jsonrpc": "2.0", "id": 1, "method": "initialize",
                                      "params": {"protocolVersion": "2025-03-26", "capabilities": {},
                                                 "clientInfo": {"name": "health", "version": "0.1"}}},
                                headers={"Accept": "application/json, text/event-stream"},
                                timeout=5.0,
                            )
                            if resp.status_code == 200:
                                break
                    except Exception:
                        pass  # Expected during startup — logged only on final failure

                if proxy_process.poll() is not None:
                    stderr = proxy_process.stderr.read().decode() if proxy_process.stderr else ""
                    yield _sse("progress", {"phase": "proxy", "message": f"Proxy failed to start: {stderr[:200]}"})
                    proxy_port = None
                    proxy_process = None
                    session.proxy_process = None
                else:
                    session.proxy_process = proxy_process
                    # Get proxy tool list
                    from fastmcp import Client
                    proxy_client = Client(f"http://localhost:{proxy_port}/mcp")
                    async with proxy_client:
                        proxy_tools_list = await proxy_client.list_tools()
                        proxy_tools = len(proxy_tools_list)
                        # Calculate proxy menu tokens
                        proxy_menu_tokens = sum(
                            len(f"{t.name}: {t.description or ''}") // 4 + len(json.dumps(t.inputSchema or {})) // 4
                            for t in proxy_tools_list
                        )
                    yield _sse("progress", {
                        "phase": "proxy",
                        "message": f"Proxy running on port {proxy_port} with {proxy_tools} tools (was {len(session.tools)})"
                    })
            except Exception as e:
                yield _sse("progress", {"phase": "proxy", "message": f"Proxy start failed: {e}"})

        # --- Step 4: Re-run prompts through proxy ---
        proxy_traces = []
        proxy_answers = []  # Capture proxy answers for LLM-as-judge
        proxy_tool_count = proxy_tools or 0
        if not proxy_port:
            yield _sse("progress", {"phase": "evaluate", "message": "Skipping proxy evaluation (no proxy available)"})
        elif not session.api_key:
            yield _sse("progress", {"phase": "evaluate", "message": "Skipping proxy evaluation (no API key)"})
        elif not session.eval_results:
            yield _sse("progress", {"phase": "evaluate", "message": "Skipping proxy evaluation (no evaluation prompts)"})
        else:
            try:
                llm = LLMClient(session.api_key, session.model, session.provider, session.custom_endpoint)
                from fastmcp import Client as McpClient

                # Build tool list from proxy — keep connection open for all prompts
                proxy_mcp = McpClient(f"http://localhost:{proxy_port}/mcp")
                async with proxy_mcp:
                    proxy_tools_defs = await proxy_mcp.list_tools()
                    proxy_tools_list = [{
                        "name": t.name,
                        "description": t.description or "",
                        "input_schema": t.inputSchema or {"type": "object", "properties": {}},
                    } for t in proxy_tools_defs]
                    included_evals = [(i, e) for i, e in enumerate(session.eval_results) if i in included]
                    yield _sse("progress", {"phase": "evaluate", "message": f"Re-running {len(included_evals)} prompts through proxy ({len(proxy_tools_list)} tools)..."})
                    for eval_num, (i, eval_result) in enumerate(included_evals, 1):
                        prompt = eval_result["prompt"]
                        yield _sse("progress", {
                            "phase": "evaluate",
                            "message": f"Re-running prompt {eval_num}/{len(included_evals)}: {prompt[:50]}..."
                        })

                        # Run the same prompt through the proxy
                        messages = [{"role": "user", "content": prompt}]
                        step = 0
                        proxy_answer = ""
                        try:
                            while True:
                                response = await llm.chat(messages=messages, tools=proxy_tools_list, max_tokens=4096)

                                if not response.tool_calls:
                                    proxy_answer = response.text
                                    proxy_answers.append({"prompt": prompt, "answer": proxy_answer})
                                    break

                                messages.append({
                                    "role": "assistant",
                                    "content": llm.to_anthropic_blocks(response),
                                })

                                tool_results = []
                                for tool_use in response.tool_calls:
                                    step += 1
                                    start = time.time()
                                    error = None
                                    result_text = ""

                                    try:
                                        result = await proxy_mcp.call_tool(tool_use.name, tool_use.input)
                                        result_text = _serialize_mcp_result(result)
                                    except Exception as e:
                                        error = str(e)
                                        result_text = f"Error: {error}"

                                    duration = time.time() - start

                                    proxy_traces.append({
                                        "step": step,
                                        "timestamp": start,
                                        "tool_name": tool_use.name,
                                        "tool_input": tool_use.input,
                                        "tool_response_chars": len(result_text),
                                        "tool_response_tokens_est": max(1, len(result_text) // 4),
                                        "tool_response_fields": _extract_fields(result_text),
                                        "tool_duration_s": round(duration, 3),
                                        "error_category": error if error else None,
                                    })

                                    tool_results.append({
                                        "type": "tool_result",
                                        "tool_use_id": tool_use.id,
                                        "content": result_text,
                                    })

                                messages.append({"role": "user", "content": tool_results})
                        except Exception as e:
                            proxy_answers.append({"prompt": prompt, "answer": f"Error: {e}"})
                            yield _sse("progress", {
                                "phase": "evaluate",
                                "message": f"Prompt {i+1} failed: {str(e)[:100]}"
                            })

            except Exception as e:
                logger.exception("Proxy evaluation failed")
                yield _sse("progress", {"phase": "evaluate", "message": f"Proxy evaluation failed: {e}"})

        # --- Step 6: LLM-as-judge — compare baseline vs proxy answers ---
        judge_results = []
        proxy_correct = 0
        proxy_total = 0
        judge_key = session.judge_api_key or session.api_key
        if proxy_answers and judge_key:
            yield _sse("progress", {"phase": "judge", "message": "Comparing baseline vs optimized answers..."})
            try:
                judge = LLMClient(
                    judge_key,
                    session.judge_model or session.model,
                    session.judge_provider or session.provider,
                    session.judge_endpoint or session.custom_endpoint,
                )

                for i, proxy_entry in enumerate(proxy_answers):
                    if i >= len(session.eval_results):
                        break
                    baseline_answer = session.eval_results[i].get("answer", "")
                    proxy_answer = proxy_entry.get("answer", "")
                    prompt = proxy_entry.get("prompt", "")

                    if not baseline_answer or not proxy_answer or proxy_answer.startswith("Error:"):
                        judge_results.append({"prompt": prompt, "verdict": "error", "explanation": "Proxy failed to produce an answer", "baseline_answer": baseline_answer[:2000], "proxy_answer": proxy_answer[:2000]})
                        continue

                    yield _sse("progress", {
                        "phase": "judge",
                        "message": f"Judging prompt {i+1}/{len(proxy_answers)}: {prompt[:50]}..."
                    })

                    judge_response = await judge.chat(
                        messages=[{
                            "role": "user",
                            "content": (
                                "You are comparing two LLM-generated answers to the same question. "
                                "Your job is to determine if they provide the same USEFUL information to the user. "
                                "Be lenient — differences in wording, formatting, ordering, level of detail, "
                                "markdown structure, or conversational tone do NOT matter. "
                                "What matters is: would a user get the same actionable information from both answers?\n\n"
                                f"QUESTION: {prompt}\n\n"
                                f"ANSWER A (baseline):\n{baseline_answer[:2000]}\n\n"
                                f"ANSWER B (optimized):\n{proxy_answer[:2000]}\n\n"
                                "Respond with exactly one of these verdicts on the first line, followed by a brief explanation:\n"
                                "EQUIVALENT - both answers provide the same useful information (even if worded differently, in different order, or with different formatting)\n"
                                "PARTIAL - one answer is missing a key fact that the other includes\n"
                                "DIFFERENT - the answers provide materially different information or data"
                            ),
                        }],
                        max_tokens=300,
                    )

                    judge_text = judge_response.text.strip()
                    first_line = judge_text.split("\n")[0].strip().upper()
                    explanation = "\n".join(judge_text.split("\n")[1:]).strip()

                    if "EQUIVALENT" in first_line or "IDENTICAL" in first_line:
                        verdict = "equivalent"
                        proxy_correct += 1
                    elif "PARTIAL" in first_line:
                        verdict = "partial"
                    else:
                        verdict = "different"

                    proxy_total += 1
                    judge_results.append({
                        "prompt": prompt,
                        "verdict": verdict,
                        "explanation": explanation,
                        "baseline_answer": baseline_answer[:2000],
                        "proxy_answer": proxy_answer[:2000],
                    })

                yield _sse("progress", {
                    "phase": "judge",
                    "message": f"Answer comparison: {proxy_correct}/{proxy_total} equivalent"
                })
            except Exception as e:
                yield _sse("progress", {"phase": "judge", "message": f"Answer comparison failed: {str(e)[:100]}"})

        # --- Step 7: Compute comparison ---
        yield _sse("progress", {"phase": "compare", "message": "Computing before/after comparison..."})

        # Build comparison from measured data
        baseline_tokens = sum(t.get("tool_response_tokens_est", 0) for t in session.traces)
        proxy_tokens_total = sum(t.get("tool_response_tokens_est", 0) for t in proxy_traces)
        baseline_calls = len(session.traces)
        proxy_calls = len(proxy_traces)
        baseline_errors = sum(1 for t in session.traces if t.get("error_category"))
        proxy_errors = sum(1 for t in proxy_traces if t.get("error_category"))
        num_prompts = max(len(session.eval_results), 1)

        orig_menu = sum(
            len(f"{t.name}: {t.description or ''}") // 4 + len(json.dumps(t.inputSchema or {})) // 4
            for t in session.tools
        )

        baseline_avg = round(baseline_tokens / num_prompts, 1)
        baseline = {
            "tool_count": len(session.tools),
            "menu_tokens": orig_menu,
            "avg_tokens_per_prompt": baseline_avg,
            "avg_calls_per_prompt": round(baseline_calls / num_prompts, 1),
            "total_context": round(orig_menu + baseline_avg, 1),
        }

        proxy_avg = round(proxy_tokens_total / num_prompts, 1) if proxy_traces else None
        proxy = {
            "tool_count": proxy_tool_count if proxy_tool_count > 0 else None,
            "menu_tokens": proxy_menu_tokens if proxy_menu_tokens > 0 else None,
            "avg_tokens_per_prompt": proxy_avg,
            "avg_calls_per_prompt": round(proxy_calls / num_prompts, 1) if proxy_traces else None,
            "total_context": round(proxy_menu_tokens + proxy_avg, 1) if proxy_menu_tokens and proxy_avg is not None else None,
        }

        # Calculate deltas with percentages
        delta = {}
        for key in baseline:
            b = baseline[key]
            p = proxy[key]
            if b is not None and p is not None and isinstance(b, (int, float)) and isinstance(p, (int, float)):
                diff = round(p - b, 3)
                pct = round((p - b) / b * 100, 1) if b != 0 else (0 if p == 0 else None)
                delta[key] = {"value": diff, "pct": pct}

        comparison = {"baseline": baseline, "proxy": proxy, "delta": delta, "judge_results": judge_results}

        session.comparison = comparison

        yield _sse("progress", {"phase": "complete", "message": "Optimization complete!"})

        yield _sse("done", {
            "status": "complete",
            "recommendationCount": len(session.recommendations),
            "comparison": session.comparison,
            "proxyToolCount": proxy_tool_count,
            "baselineToolCount": len(session.tools),
        })

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def _generate_proxy_for_recommendations(recommendations, tools, upstream_url):
    """Generate proxy code, handling the recommendation format from analyze.py."""
    from backend.mcp_optimizer.inventory import find_name_clusters, tool_token_budget

    # Build a practical proxy: consolidate no-param lookup tools + passthrough rest
    no_param_tools = []
    for t in tools:
        schema = t.inputSchema or {}
        props = schema.get("properties", {})
        required = schema.get("required", [])
        if not props and not required:
            no_param_tools.append(t.name)

    # Generate proxy code directly (simpler than going through proxy_generator)
    lookup_map = {}
    for name in no_param_tools:
        # Strip common prefixes to make table names
        short = name
        for prefix in ["get_", "list_", "fetch_"]:
            if short.startswith(prefix):
                short = short[len(prefix):]
                break
        lookup_map[short] = name

    special_tools = set(no_param_tools)

    # Build proxy code
    lines = [
        '"""Auto-generated MCP proxy server by MCPeriscope."""',
        "",
        "from __future__ import annotations",
        "import argparse",
        "import json",
        "from contextlib import asynccontextmanager",
        "from fastmcp import FastMCP",
        "from backend.mcp_optimizer.proxy_runtime import UpstreamClient",
        "",
        f"UPSTREAM_URL = {json.dumps(upstream_url)}",
        "",
        f"LOOKUP_TOOLS = {json.dumps(lookup_map, indent=2)}",
        "",
        f"REMOVED_TOOLS = []",
        "",
        "SPECIAL_TOOLS = set(LOOKUP_TOOLS.values())",
        "",
        f"TOKEN_DIR = {json.dumps(str(Path.home() / '.mcperiscope' / 'tokens'))}",
        "",
        "upstream = UpstreamClient(UPSTREAM_URL, token_dir=TOKEN_DIR)",
        "",
        "@asynccontextmanager",
        "async def lifespan(app):",
        "    await upstream.connect()",
        "    try:",
        "        yield",
        "    finally:",
        "        await upstream.disconnect()",
        "",
        'mcp = FastMCP("mcperiscope-proxy", lifespan=lifespan)',
        "",
        "@mcp.tool()",
        "async def lookup(table: str) -> str:",
        '    """Look up reference data by table name. Available tables: ' + ", ".join(sorted(lookup_map.keys())) + '"""',
        "    if table not in LOOKUP_TOOLS:",
        '        return json.dumps({"error": f"Unknown table: {table}. Available: {sorted(LOOKUP_TOOLS.keys())}"})',
        "    result = await upstream.call(LOOKUP_TOOLS[table], {})",
        "    return json.dumps(result) if not isinstance(result, str) else result",
        "",
    ]

    # Generate passthrough tools
    for t in tools:
        if t.name in special_tools:
            continue
        schema = t.inputSchema or {}
        props = schema.get("properties", {})
        required_set = set(schema.get("required", []))
        desc = (t.description or "").replace('"', '\\"').replace("\n", " ")

        # Build params
        params = []
        args_entries = []
        for pname, pschema in props.items():
            ptype = {"string": "str", "integer": "int", "number": "float", "boolean": "bool"}.get(
                pschema.get("type", "string"), "str"
            )
            if pname in required_set:
                params.append(f"{pname}: {ptype}")
            else:
                params.append(f"{pname}: {ptype} | None = None")
            args_entries.append(f'"{pname}": {pname}')

        param_str = ", ".join(params)
        args_str = "{" + ", ".join(args_entries) + "}" if args_entries else "{}"

        lines.append(f'@mcp.tool(description="{desc[:500]}")')
        lines.append(f"async def {t.name}({param_str}) -> str:")
        lines.append(f"    args = {{k: v for k, v in {args_str}.items() if v is not None}}")
        lines.append(f'    result = await upstream.call("{t.name}", args)')
        lines.append(f"    return json.dumps(result) if not isinstance(result, str) else result")
        lines.append("")

    # Entry point
    lines.extend([
        'if __name__ == "__main__":',
        '    parser = argparse.ArgumentParser()',
        '    parser.add_argument("--port", type=int, default=8000)',
        '    args = parser.parse_args()',
        '    mcp.run(transport="streamable-http", port=args.port)',
    ])

    code = "\n".join(lines)

    # Save to file
    proxy_dir = session.project_dir / "proxy"
    proxy_dir.mkdir(parents=True, exist_ok=True)
    (proxy_dir / "server.py").write_text(code)

    return code


def _start_proxy(proxy_code: str) -> tuple[int, subprocess.Popen]:
    """Start the proxy server on a random port. Returns (port, process)."""
    # Find available port
    with socket.socket() as s:
        s.bind(("", 0))
        port = s.getsockname()[1]

    proxy_file = session.project_dir / "proxy" / "server.py"

    # Set cwd to project root so backend.mcp_optimizer imports work
    project_root = Path(__file__).resolve().parent.parent.parent
    process = subprocess.Popen(
        [sys.executable, str(proxy_file), "--port", str(port)],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        cwd=str(project_root),
    )

    return port, process


def _serialize_message_content(content) -> str:
    """Convert message content (string, list of blocks, or tool results) to readable text."""
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return str(content)

    parts = []
    for block in content:
        if isinstance(block, str):
            parts.append(block)
        elif isinstance(block, dict):
            btype = block.get("type", "")
            if btype == "text":
                parts.append(block.get("text", ""))
            elif btype == "tool_use":
                args = json.dumps(block.get("input", {}), indent=2)
                parts.append(f"[Tool Call: {block.get('name', '?')}]\n{args}")
            elif btype == "tool_result":
                content_val = block.get("content", "")
                parts.append(f"[Tool Result: {block.get('tool_use_id', '?')[:8]}...]\n{content_val}")
            else:
                parts.append(json.dumps(block, indent=2))
        else:
            parts.append(str(block))
    return "\n\n".join(parts)


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


