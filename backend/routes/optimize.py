from __future__ import annotations

import copy
import json
import logging
import os
import subprocess
import sys
import time
import socket
from collections.abc import AsyncGenerator, Awaitable, Callable, Iterable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from pydantic import BaseModel, Field
from backend.models import MAX_TOOL_ROUNDS, CustomContextWindow, EvaluateRequest
from backend.state import OptimizationRun, session
from backend import mcp_manager
from backend.credentials import (
    analyst_destination,
    bind_analyst_credentials,
    bind_primary_credentials,
    clear_analyst_credentials,
)
from backend.llm_client import LLMClient
from backend.mcp_optimizer.inventory import estimate_tokens
from backend.mcp_optimizer.token_store import TOKEN_DIR
from backend.routes._common import (
    RESOURCE_REC_TYPES,
    _baseline_figures,
    _get_visible_quick_wins,
    _baseline_population,
    _live_eval_indices,
    _make_trace_event,
    _menu_tokens,
    _require_connected,
    _resource_tokens,
    _run_and_store_analysis,
    _sse,
    _total_context,
)
from backend.url_validation import validate_external_url

logger = logging.getLogger(__name__)

router = APIRouter()

# Resource text shorter than this isn't worth an analyst condensing call
CONDENSE_MIN_CHARS = 500


def _sanitized_auth(auth) -> dict | None:
    """Reduce the session AuthConfig to what the generated proxy needs.

    OAuth carries no secrets (tokens live in token_dir); the other methods
    need their credential fields for the proxy to reach the upstream.
    """
    if auth is None:
        return None
    if auth.type in ("bearer", "header", "oauth_client_creds"):
        return auth.model_dump(exclude_none=True)
    if auth.type == "none":
        return {"type": "none"}
    return {k: v for k, v in {"type": "oauth", "scope": auth.scope}.items() if v}


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


def _llm_error_message(e: Exception) -> str:
    """Map an LLM SDK exception to a user-facing answer string."""
    import anthropic
    import openai

    status = getattr(e, "status_code", None)
    if status == 502:
        return "Error: LLM provider returned Bad Gateway (502). The service may be down or overloaded."
    if isinstance(e, (anthropic.AuthenticationError, openai.AuthenticationError)) or status == 401:
        return "Error: Authentication failed. Check your API key in Settings."
    if isinstance(e, (anthropic.RateLimitError, openai.RateLimitError)) or status == 429:
        return "Error: Rate limit exceeded. Wait a moment and try again."
    # Timeout errors subclass connection errors in both SDKs, so check them first.
    if isinstance(e, (anthropic.APITimeoutError, openai.APITimeoutError)):
        return "Error: Request timed out. The LLM provider may be slow or unreachable."
    if isinstance(e, (anthropic.APIConnectionError, openai.APIConnectionError)):
        return "Error: Could not connect to the LLM provider. Check the endpoint in Settings."
    return f"Error: {e}"


def _analyst_pairs(proxy_answers: list[dict], eval_results: list[dict]) -> list[tuple[str, dict, dict]]:
    """Pair each proxy answer with the baseline eval it re-ran.

    Returns (prompt, baseline eval, proxy answer entry) tuples; both dicts
    carry "answer" and the "error"/"stopped" flags. Proxy answers carry the
    original eval index because only the included evals are re-run.
    """
    pairs = []
    for entry in proxy_answers:
        idx = entry.get("index")
        if idx is None or not 0 <= idx < len(eval_results):
            continue
        pairs.append((entry.get("prompt", ""), eval_results[idx], entry))
    return pairs


def _failed_answer_reason(baseline: dict, proxy: dict) -> str | None:
    """Why an answer pair can't be compared, or None if it can.

    Such pairs are skipped by the analyst rather than judged different.
    """
    for side, entry in (("Baseline", baseline), ("Proxy", proxy)):
        if entry.get("error"):
            return f"{side} run failed with an error"
        if entry.get("stopped"):
            return f"{side} run hit the tool call round limit"
        if not entry.get("answer"):
            return f"{side} run produced no answer"
    return None


def _accuracy_counts(analyst_results: list[dict]) -> tuple[int, int]:
    """(equivalent, compared) analyst verdicts; skipped "error" pairs don't count."""
    compared = [r for r in analyst_results if r.get("verdict") in ("equivalent", "partial", "different")]
    return sum(1 for r in compared if r["verdict"] == "equivalent"), len(compared)


def _tools_for_llm(tool_objs: Iterable) -> list[dict]:
    """Convert MCP Tool objects to the tool dicts LLMClient expects."""
    return [{
        "name": t.name,
        "description": t.description or "",
        "input_schema": t.inputSchema or {"type": "object", "properties": {}},
    } for t in tool_objs]


def _resource_preamble(resources: Iterable[dict]) -> list[dict]:
    """Messages that put loaded resources ({name, content}) in the LLM context."""
    resource_parts = [f"## {res['name']}\n\n{res['content']}" for res in resources]
    if not resource_parts:
        return []
    return [
        {
            "role": "user",
            "content": (
                "The following resources have been loaded for reference:\n\n"
                + "\n\n---\n\n".join(resource_parts)
            ),
        },
        {"role": "assistant", "content": "I've reviewed the loaded resources and will use them to help answer your questions."},
    ]


def _proxy_resource_preamble(
    loaded: dict[str, dict], condensed: dict[str, dict], disabled: set[str],
) -> list[dict]:
    """Resource preamble for the proxy re-run: enabled resources, condensed where condensed."""
    return _resource_preamble(
        {**res, "content": condensed[uri]["condensed"]} if uri in condensed else res
        for uri, res in loaded.items()
        if uri not in disabled
    )


def _analyst_llm() -> LLMClient | None:
    """Build the analyst LLM client, or None if there is no key it may use.

    Blank analyst fields inherit the primary LLM's (see analyst_destination).
    A key is only used for the exact (provider, endpoint) it is bound to: the
    analyst key when the destination still matches its binding, else the
    primary key when the destination is the primary's — never anywhere else.
    """
    model = session.analyst_model or session.model
    destination = analyst_destination(session)
    if session.analyst_api_key and destination == (
        session.analyst_api_key_provider, session.analyst_api_key_endpoint,
    ):
        key = session.analyst_api_key
    elif session.api_key and destination == (session.api_key_provider, session.api_key_endpoint):
        key = session.api_key
    else:
        return None
    if not model:
        return None
    return LLMClient(key, model, *destination)


@dataclass
class _AgentRun:
    """State of one agent loop. Totals stay valid if the loop raises midway."""
    messages: list[dict]
    final_answer: str = ""
    step: int = 0  # tool calls made
    rounds: int = 0  # LLM API calls made
    tool_chain: list[dict] = field(default_factory=list)
    trace_events: list[dict] = field(default_factory=list)
    input_tokens: int = 0
    output_tokens: int = 0
    peak_input_tokens: int = 0  # Last round's input_tokens = actual context window usage
    hit_max_rounds: bool = False


async def _run_agent_loop(
    run: _AgentRun,
    llm: LLMClient,
    tools: list[dict],
    call_tool: Callable[[str, dict], Awaitable[Any]],
    *,
    max_rounds: int,
    max_tokens: int,
    stream: bool,
    context_base: int = 0,
    prompt_index: int | None = None,
) -> AsyncGenerator[tuple[str, dict], None]:
    """Run the LLM tool-calling loop until a final answer, yielding (event, data).

    The events are the evaluate SSE events (thinking, text_delta,
    context_update, tool_calling, tool_result, error). `run` is updated in
    place; LLM errors propagate to the caller. Trace events are tagged with
    `prompt_index` and number their steps from 1 within this loop.
    """
    context_delta = 0  # Estimated tokens added since last API report
    round_num = 0
    while True:
        round_num += 1
        if round_num > max_rounds:
            run.hit_max_rounds = True
            yield "error", {"message": f"Max tool call rounds ({max_rounds}) exceeded"}
            return
        yield "thinking", {"step": run.step, "context_tokens": context_base + context_delta}
        run.rounds += 1

        if stream:
            # Stream the LLM response — yields text deltas then final LLMResponse
            response = None
            async for item in llm.chat_stream(messages=run.messages, tools=tools, max_tokens=max_tokens):
                if isinstance(item, str):
                    yield "text_delta", {"text": item}
                else:
                    response = item
            if response is None:
                yield "error", {"message": "No response from LLM"}
                return
        else:
            response = await llm.chat(messages=run.messages, tools=tools, max_tokens=max_tokens)

        # Replace estimate with API-reported value — this is authoritative
        run.input_tokens += response.input_tokens
        run.output_tokens += response.output_tokens
        run.peak_input_tokens = response.input_tokens
        if response.input_tokens > 0:
            context_base = response.input_tokens
            context_delta = 0  # Reset delta — base is now accurate
            yield "context_update", {"context_tokens": context_base, "source": "api"}

        if not response.tool_calls:
            run.final_answer = response.text
            return

        run.messages.append({
            "role": "assistant",
            "content": llm.to_anthropic_blocks(response),
        })

        tool_results = []
        for tool_use in response.tool_calls:
            run.step += 1
            start = time.time()
            error = None

            yield "tool_calling", {
                "step": run.step,
                "tool": tool_use.name,
                "input": tool_use.input,
            }

            try:
                result = await call_tool(tool_use.name, tool_use.input)
                result_text = _serialize_mcp_result(result)
            except Exception as e:
                error = str(e)
                result_text = f"Error: {error}"

            duration = time.time() - start

            # Update context delta estimate (~4 chars/token, standard BPE approximation)
            context_delta += estimate_tokens(json.dumps(tool_use.input)) + estimate_tokens(result_text)

            tool_step = {
                "step": run.step,
                "tool": tool_use.name,
                "input": tool_use.input,
                "output": result_text,
                "duration": round(duration, 3),
                "error": error,
                "context_tokens": context_base + context_delta,
            }
            run.tool_chain.append(tool_step)
            yield "tool_result", tool_step

            run.trace_events.append(_make_trace_event(
                run.step, start, tool_use.name, tool_use.input, result_text, duration, error,
                prompt_index=prompt_index,
            ))

            tool_results.append({
                "type": "tool_result",
                "tool_use_id": tool_use.id,
                "content": result_text,
            })

        run.messages.append({"role": "user", "content": tool_results})


@router.post("/optimize/evaluate")
async def evaluate(req: EvaluateRequest):
    """Run an evaluation prompt with SSE streaming of tool calls."""
    _require_connected()
    if req.custom_endpoint:
        validate_external_url(req.custom_endpoint, label="LLM endpoint")
    bind_primary_credentials(
        session,
        api_key=req.api_key,
        provider=req.provider,
        custom_endpoint=req.custom_endpoint,
        model=req.model,
    )
    if req.custom_context_window:
        session.custom_context_window = req.custom_context_window
    if not session.api_key:
        raise HTTPException(status_code=400, detail="API key not configured")
    if not session.tools:
        raise HTTPException(status_code=400, detail="No tools available")

    # Capture values before entering generator (req may not be available inside)
    _api_key = session.api_key
    _model = session.model
    _provider = session.provider
    _endpoint = session.custom_endpoint
    _max_tokens = req.max_tokens or 4096
    _max_rounds = req.max_tool_rounds or 20

    async def event_stream():
        try:
            client = LLMClient(_api_key, _model, _provider, _endpoint)
        except Exception as e:
            yield _sse("error", {"message": f"Failed to initialize LLM client: {e}"})
            return

        tools = _tools_for_llm(session.tools)

        # Build conversation history from previous evaluations
        # Include the FULL message history (tool calls + results) to mirror
        # real-world behavior where tool responses accumulate in context
        # Inject loaded resources as context at the start
        messages = _resource_preamble(session.loaded_resources.values())

        # Deleted evals are left out, as if they never ran.
        live_evals = [session.eval_results[i] for i in _live_eval_indices()]
        for prev in live_evals:
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

        # Context tracking: use API-reported base + estimated delta from new content
        # Initialize base from prior eval's peak if available, otherwise estimate from messages
        context_base = 0
        for prev_ev in live_evals:  # This eval isn't appended until it finishes
            peak = (prev_ev.get("usage") or {}).get("peak_context_tokens", 0)
            if peak:
                context_base = peak
        if context_base == 0:
            # Estimate from tool definitions + messages
            context_base = _menu_tokens(session.tools)
            for m in messages:
                c = m.get("content", "")
                context_base += estimate_tokens(c if isinstance(c, str) else json.dumps(c))

        run = _AgentRun(messages=messages)
        errored = False
        try:
            async for event, data in _run_agent_loop(
                run, client, tools, mcp_manager.call_tool,
                max_rounds=_max_rounds,
                max_tokens=_max_tokens,
                stream=True,
                context_base=context_base,
            ):
                yield _sse(event, data)
        except Exception as e:
            logger.exception("Evaluation error")
            # Show a clean error message without the full traceback
            run.final_answer = _llm_error_message(e)
            errored = True
        if run.hit_max_rounds:
            run.final_answer = f"[Stopped after {_max_rounds} tool call rounds — increase limit in Settings]"
        final_answer = run.final_answer
        tool_chain = run.tool_chain
        trace_events = run.trace_events

        usage = {
            "input_tokens": run.input_tokens,
            "output_tokens": run.output_tokens,
            "total_tokens": run.input_tokens + run.output_tokens,
            "peak_context_tokens": run.peak_input_tokens,  # Actual context window usage (last round)
            "api_rounds": run.rounds,  # Number of LLM API calls made
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
            # Failed runs have no real answer; the analyst skips them.
            "error": errored,
            "stopped": run.hit_max_rounds,
        }
        # Tag traces with this eval's index (its position in eval_results) at
        # append time, so concurrent evals can't mislabel them.
        for t in trace_events:
            t["prompt_index"] = len(session.eval_results)
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
            "error": errored,
            "stopped": run.hit_max_rounds,
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
    if session.eval_results[index].get("deleted"):
        raise HTTPException(status_code=410, detail="Evaluation was deleted")
    ctx = session.eval_results[index].get("contextWindow")
    if not ctx:
        raise HTTPException(status_code=404, detail="No context window data")
    return ctx


@router.delete("/optimize/eval/{index}")
async def delete_eval(index: int):
    """Delete an evaluation by tombstoning it, so later indices stay stable.

    A deleted eval is left out of history replay, analysis, the baseline and
    reports; its traces are dropped from session.traces. Idempotent.
    """
    if index < 0 or index >= len(session.eval_results):
        raise HTTPException(status_code=404, detail="Evaluation not found")
    session.eval_results[index]["deleted"] = True
    session.traces = [t for t in session.traces if t.get("prompt_index") != index]
    return {"index": index, "deleted": True}


@router.post("/optimize/analyze")
async def analyze_tools():
    """Run analysis on tool usage traces to generate recommendations."""
    _require_connected()
    # Manual Explore-tab calls (prompt_index None) aren't evaluation traces.
    if not any(t.get("prompt_index") is not None for t in session.traces):
        raise HTTPException(status_code=400, detail="No evaluation traces. Run prompts on the Evaluate tab first.")
    _run_and_store_analysis()
    # Traces exist now, so quick wins like remove_unused can be generated.
    from backend.routes.analysis import refresh_quick_wins
    await refresh_quick_wins()
    return {
        "recommendations": session.recommendations,
        "quickWins": _get_visible_quick_wins(),
    }


class OptimizeRunRequest(BaseModel):
    included_indices: list[int] | None = None
    enabled_rec_ids: list[str] | None = None  # if None, use all
    api_key: str | None = None
    model: str | None = None
    provider: str | None = None
    custom_endpoint: str | None = None
    analyst_model: str | None = None
    analyst_provider: str | None = None
    analyst_api_key: str | None = None
    analyst_endpoint: str | None = None
    # True = analyst is "same as agent": clears every stored analyst_* field
    # (the analyst_* fields above are then ignored).
    analyst_inherit: bool = False
    custom_context_window: int | None = CustomContextWindow
    disabled_tools: list[str] | None = None
    disabled_resources: list[str] | None = None
    disabled_prompts: list[str] | None = None
    max_tool_rounds: int | None = Field(default=None, ge=1, le=MAX_TOOL_ROUNDS)


@router.post("/optimize/run")
async def run_optimize(req: OptimizeRunRequest | None = None):
    """Full optimization pipeline with SSE progress streaming.

    Steps: analyze (+ condense resources) → generate proxy → start proxy →
    re-run prompts → compare answers → compute comparison
    """
    _require_connected()

    if req and req.custom_endpoint:
        validate_external_url(req.custom_endpoint, label="LLM endpoint")
    if req and req.analyst_endpoint:
        validate_external_url(req.analyst_endpoint, label="Analyst LLM endpoint")

    bind_primary_credentials(
        session,
        api_key=req.api_key if req else None,
        provider=req.provider if req else None,
        custom_endpoint=req.custom_endpoint if req else None,
        model=req.model if req else None,
    )
    if req and req.analyst_inherit:
        clear_analyst_credentials(session)
    else:
        bind_analyst_credentials(
            session,
            api_key=req.analyst_api_key if req else None,
            provider=req.analyst_provider if req else None,
            endpoint=req.analyst_endpoint if req else None,
            model=req.analyst_model if req else None,
        )
    if req and req.custom_context_window:
        session.custom_context_window = req.custom_context_window
    if not session.api_key:
        raise HTTPException(status_code=400, detail="API key not configured")

    # Kill any proxy left over from a previous run
    session.kill_proxy()

    # Filter to only included evaluations
    live = set(_live_eval_indices())
    included = set(req.included_indices) & live if req and req.included_indices is not None else live
    included_evals = [e for i, e in enumerate(session.eval_results) if i in included]
    if not included_evals:
        raise HTTPException(status_code=400, detail="No evaluations included")
    max_rounds = (req.max_tool_rounds if req else None) or 20
    disabled_res_set = set(req.disabled_resources) if req and req.disabled_resources else set()

    async def event_stream():
        import asyncio

        # --- Step 1: Analyze (only if not already done) ---
        if not session.analysis:
            yield _sse("progress", {"phase": "analyze", "message": "Analyzing tool usage patterns..."})
            try:
                _run_and_store_analysis()
            except Exception as e:
                yield _sse("error", {"message": f"Analysis failed: {e}"})
                return
        else:
            yield _sse("progress", {"phase": "analyze", "message": f"Using existing analysis ({len(session.recommendations)} recommendations)"})

        # Filter recommendations if enabled_rec_ids is provided
        enabled_rec_ids_set = None
        if req and req.enabled_rec_ids is not None:
            enabled_rec_ids_set = set(req.enabled_rec_ids)
            filtered_recs = [r for r in session.recommendations if r.get("id") in enabled_rec_ids_set]
            filtered_qws = [q for q in session.quick_wins if q.get("id") in enabled_rec_ids_set]
        else:
            filtered_recs = session.recommendations
            filtered_qws = session.quick_wins

        # Track which IDs are enabled for this run
        run_enabled_ids = [r.get("id") for r in filtered_recs if r.get("id")] + [q.get("id") for q in filtered_qws if q.get("id")]

        rec_count = len(filtered_recs)
        qw_count = len(filtered_qws)
        yield _sse("progress", {"phase": "analyze", "message": f"Selected {rec_count + qw_count} optimizations ({rec_count} behavior, {qw_count} inventory)"})

        if rec_count == 0 and not filtered_qws:
            yield _sse("done", {
                "status": "complete",
                "recommendationCount": 0,
                "comparison": None,
                "message": "No optimizations found",
            })
            return

        # Enabled recs this run could not apply, as {id, type, reason}
        skipped_recs: list[dict] = []

        def skip_recs(recs: list[dict], reason: str) -> str:
            """Record recs as skipped; return an SSE warning naming them."""
            skipped_recs.extend({"id": r.get("id"), "type": r.get("type"), "reason": reason} for r in recs)
            return _sse("progress", {
                "phase": "proxy", "level": "warning",
                "message": f"Skipped {len(recs)} optimization(s): {reason}",
            })

        no_analyst_reason = "no API key usable for the analyst LLM"

        # --- Step 1b: Condense resources if resource recommendations are enabled ---
        condensed_resources = {}  # uri -> {name, original, condensed, original_tokens, condensed_tokens}
        resource_recs = [r for r in filtered_recs + filtered_qws if r.get("type") in RESOURCE_REC_TYPES]

        if resource_recs:
            analyst = _analyst_llm()
            if not analyst:
                yield skip_recs(resource_recs, f"resource condensing needs the analyst LLM ({no_analyst_reason})")
            else:
                yield _sse("progress", {"phase": "resources", "message": "Condensing resources..."})
            try:
                items = await mcp_manager.list_resources() if analyst else []

                for r in items:
                    mime_type = getattr(r, "mimeType", "") or ""
                    if mime_type != "text/markdown":
                        continue
                    uri = str(getattr(r, "uri", ""))
                    name = getattr(r, "name", "") or ""

                    try:
                        text = mcp_manager.extract_resource_text(await mcp_manager.read_resource(uri))

                        if len(text) < CONDENSE_MIN_CHARS:
                            continue  # Too short to bother condensing

                        yield _sse("progress", {"phase": "resources", "message": f"Condensing {name}..."})

                        response = await analyst.chat(
                            messages=[{
                                "role": "user",
                                "content": (
                                    "Condense this MCP resource document while preserving all key information. "
                                    "Keep tool names, parameter names, and workflow steps intact. "
                                    "Remove verbose examples, redundant explanations, and boilerplate. "
                                    "Aim for ~50% reduction in length.\n\n"
                                    f"RESOURCE: {name}\n\n"
                                    f"{text}"
                                ),
                            }],
                            max_tokens=4096,
                        )
                        condensed_resources[uri] = {
                            "name": name,
                            "original": text,
                            "condensed": response.text,
                            "original_tokens": estimate_tokens(text),
                            "condensed_tokens": estimate_tokens(response.text),
                        }
                    except Exception:
                        logger.warning("Failed to condense resource %s", name, exc_info=True)
            except Exception:
                logger.warning("Failed to list resources for condensing", exc_info=True)

        # --- Step 2: Generate proxy ---
        from backend.proxy_builder import build_proxy, batch_rewrite_descriptions

        proxy_code = None
        token_dir = str(TOKEN_DIR)

        # Step 2a: Batch rewrite descriptions if needed (ONE LLM call)
        rewritten_descriptions: dict[str, str] = {}
        desc_rewrite_recs = [
            r for r in (filtered_recs + filtered_qws)
            if r.get("type") in ("rewrite_description", "trim_descriptions")
        ]
        if desc_rewrite_recs:
            affected_names = set()
            for r in desc_rewrite_recs:
                for name in r.get("source_tools", []) + r.get("tools", []):
                    affected_names.add(name)
            tools_to_rewrite = [t for t in session.tools if t.name in affected_names]

            if tools_to_rewrite:
                analyst = _analyst_llm()
                if not analyst:
                    yield skip_recs(desc_rewrite_recs, f"description rewriting needs the analyst LLM ({no_analyst_reason})")
                else:
                    try:
                        yield _sse("progress", {"phase": "proxy", "message": f"Rewriting {len(tools_to_rewrite)} tool descriptions..."})
                        rewritten_descriptions = await batch_rewrite_descriptions(tools_to_rewrite, analyst)
                    except Exception as e:
                        logger.warning("Description rewriting failed, using originals: %s", e)
                        yield skip_recs(desc_rewrite_recs, f"description rewriting failed: {e}")

        # Step 2b: Assemble proxy code (deterministic, fast)
        yield _sse("progress", {"phase": "proxy", "message": "Assembling proxy..."})
        try:
            proxy_code, proxy_stats = build_proxy(
                tools=session.tools,
                upstream_url=mcp_manager.get_url() or "",
                token_dir=token_dir,
                recommendations=filtered_recs,
                auth_config=_sanitized_auth(mcp_manager.get_auth_config()),
                quick_wins=filtered_qws,
                condensed_resources=condensed_resources if condensed_resources else None,
                rewritten_descriptions=rewritten_descriptions if rewritten_descriptions else None,
                disabled_tools=req.disabled_tools if req else None,
                disabled_resources=req.disabled_resources if req else None,
                disabled_prompts=req.disabled_prompts if req else None,
            )

            # Save to file
            proxy_dir = session.project_dir / "proxy"
            proxy_dir.mkdir(parents=True, exist_ok=True)
            (proxy_dir / "server.py").write_text(proxy_code)

            yield _sse("progress", {
                "phase": "proxy",
                "message": (
                    f"Proxy generated: {proxy_stats['total']} tools from {proxy_stats['upstream']} "
                    f"({proxy_stats['removed']} removed, {proxy_stats['consolidated']} consolidated)"
                ),
            })
        except Exception as e:
            logger.exception("Proxy generation failed")
            yield _sse("progress", {"phase": "proxy", "message": f"Proxy generation failed: {e}"})

        # --- Step 3: Start proxy ---
        proxy_port = None
        proxy_process = None
        proxy_tools = None
        proxy_menu_tokens = 0
        if proxy_code:
            yield _sse("progress", {"phase": "proxy", "message": "Starting proxy server..."})
            try:
                proxy_port, proxy_process, proxy_stderr_file = _start_proxy()
                # Track it immediately so a client disconnect mid-wait can't orphan it
                session.proxy_process = proxy_process

                # Wait for proxy to start, check health (up to 30 seconds)
                proxy_started = False
                async with httpx.AsyncClient() as hc:
                    for attempt in range(30):
                        await asyncio.sleep(1)
                        if proxy_process.poll() is not None:
                            break  # Process died
                        if attempt > 0 and attempt % 5 == 0:
                            yield _sse("progress", {"phase": "proxy", "message": "Waiting for proxy to start..."})
                        try:
                            resp = await hc.post(
                                f"http://localhost:{proxy_port}/mcp",
                                json={"jsonrpc": "2.0", "id": 1, "method": "initialize",
                                      "params": {"protocolVersion": "2025-03-26", "capabilities": {},
                                                 "clientInfo": {"name": "health", "version": "0.1"}}},
                                headers={"Accept": "application/json, text/event-stream"},
                                timeout=5.0,
                            )
                            if resp.status_code == 200:
                                proxy_started = True
                                break
                        except Exception:
                            pass  # Expected during startup

                if not proxy_started:
                    stderr = ""
                    try:
                        stderr = proxy_stderr_file.read_text(errors="replace")[-500:]
                    except Exception:
                        pass
                    crashed = proxy_process.poll() is not None
                    session.kill_proxy()
                    if crashed:
                        yield _sse("progress", {"phase": "proxy", "message": f"Proxy crashed: {stderr}"})
                    else:
                        yield _sse("progress", {"phase": "proxy", "message": f"Proxy timed out (30s). Last stderr: {stderr}"})
                    proxy_port = None
                    proxy_process = None
                else:
                    # Get proxy tool list
                    from fastmcp import Client
                    proxy_client = Client(f"http://localhost:{proxy_port}/mcp")
                    async with proxy_client:
                        proxy_tools_list = await proxy_client.list_tools()
                        proxy_tools = len(proxy_tools_list)
                        # Calculate proxy menu tokens
                        proxy_menu_tokens = _menu_tokens(proxy_tools_list)
                    yield _sse("progress", {
                        "phase": "proxy",
                        "message": f"Proxy running with {proxy_tools} tools (was {len(session.tools)})"
                    })
            except Exception as e:
                yield _sse("progress", {"phase": "proxy", "message": f"Proxy start failed: {e}"})

        # --- Step 4: Re-run prompts through proxy ---
        proxy_traces = []
        proxy_answers = []  # Capture proxy answers for analyst comparison
        proxy_tool_count = proxy_tools or 0
        proxy_skip_reason = None
        if not proxy_port:
            proxy_skip_reason = "No proxy available"
            yield _sse("progress", {"phase": "evaluate", "message": f"Skipping proxy evaluation ({proxy_skip_reason})"})
        else:
            try:
                llm = LLMClient(session.api_key, session.model, session.provider, session.custom_endpoint)
                from fastmcp import Client as McpClient

                # Build tool list from proxy — keep connection open for all prompts
                proxy_mcp = McpClient(f"http://localhost:{proxy_port}/mcp")
                async with proxy_mcp:
                    proxy_tools_list = _tools_for_llm(await proxy_mcp.list_tools())
                    included_evals = [(i, e) for i, e in enumerate(session.eval_results) if i in included]

                    # Build resource context once
                    resource_preamble = _proxy_resource_preamble(
                        session.loaded_resources, condensed_resources, disabled_res_set,
                    )

                    yield _sse("progress", {"phase": "evaluate", "message": f"Re-running {len(included_evals)} prompts through proxy..."})
                    for eval_num, (i, eval_result) in enumerate(included_evals, 1):
                        prompt = eval_result["prompt"]
                        yield _sse("progress", {
                            "phase": "evaluate",
                            "message": f"Re-running prompt {eval_num}/{len(included_evals)}: {prompt[:50]}..."
                        })

                        # Clean context: only enabled resources + the prompt (no history)
                        run = _AgentRun(messages=[*resource_preamble, {"role": "user", "content": prompt}])
                        try:
                            async for _event in _run_agent_loop(
                                run, llm, proxy_tools_list, proxy_mcp.call_tool,
                                max_rounds=max_rounds, max_tokens=4096, stream=False,
                                prompt_index=i,
                            ):
                                pass
                            if run.hit_max_rounds:
                                proxy_answers.append({
                                    "index": i, "prompt": prompt, "error": False, "stopped": True,
                                    "answer": f"Error: stopped after {max_rounds} tool call rounds",
                                })
                                yield _sse("progress", {
                                    "phase": "evaluate",
                                    "message": f"Prompt {i+1} exceeded max tool call rounds ({max_rounds})",
                                })
                            else:
                                proxy_answers.append({
                                    "index": i, "prompt": prompt, "error": False, "stopped": False,
                                    "answer": run.final_answer,
                                })
                        except Exception as e:
                            proxy_answers.append({
                                "index": i, "prompt": prompt, "error": True, "stopped": False,
                                "answer": f"Error: {e}",
                            })
                            yield _sse("progress", {
                                "phase": "evaluate",
                                "message": f"Prompt {i+1} failed: {str(e)[:100]}"
                            })
                        proxy_traces.extend(run.trace_events)

            except Exception as e:
                logger.exception("Proxy evaluation failed")
                yield _sse("progress", {"phase": "evaluate", "message": f"Proxy evaluation failed: {e}"})

        # --- Step 5: LLM-as-analyst — compare baseline vs proxy answers ---
        analyst_results = []
        analyst = None
        if proxy_answers:
            try:
                analyst = _analyst_llm()
            except Exception as e:
                yield _sse("progress", {"phase": "analyst", "message": f"Answer comparison failed: {str(e)[:100]}"})
            if analyst is None:
                logger.info("Skipping answer comparison: no API key usable for the analyst LLM")
        if analyst:
            yield _sse("progress", {"phase": "analyst", "message": "Comparing baseline vs optimized answers..."})
            try:
                for i, (prompt, baseline_entry, proxy_entry) in enumerate(
                    _analyst_pairs(proxy_answers, session.eval_results)
                ):
                    baseline_answer = baseline_entry.get("answer", "")
                    proxy_answer = proxy_entry.get("answer", "")
                    skip_reason = _failed_answer_reason(baseline_entry, proxy_entry)
                    if skip_reason:
                        # Not counted toward accuracy: there is nothing to compare.
                        analyst_results.append({"index": proxy_entry.get("index"), "prompt": prompt, "verdict": "error", "explanation": skip_reason, "baseline_answer": baseline_answer[:2000], "proxy_answer": proxy_answer[:2000]})
                        continue

                    yield _sse("progress", {
                        "phase": "analyst",
                        "message": f"Comparing prompt {i+1}/{len(proxy_answers)}: {prompt[:50]}..."
                    })

                    analyst_response = await analyst.chat(
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

                    analyst_text = analyst_response.text.strip()
                    first_line = analyst_text.split("\n")[0].strip().upper()
                    explanation = "\n".join(analyst_text.split("\n")[1:]).strip()

                    if "EQUIVALENT" in first_line or "IDENTICAL" in first_line:
                        verdict = "equivalent"
                    elif "PARTIAL" in first_line:
                        verdict = "partial"
                    else:
                        verdict = "different"

                    analyst_results.append({
                        "index": proxy_entry.get("index"),
                        "prompt": prompt,
                        "verdict": verdict,
                        "explanation": explanation,
                        "baseline_answer": baseline_answer[:2000],
                        "proxy_answer": proxy_answer[:2000],
                    })

                correct, compared = _accuracy_counts(analyst_results)
                yield _sse("progress", {
                    "phase": "analyst",
                    "message": f"Answer comparison: {correct}/{compared} equivalent"
                })
            except Exception as e:
                yield _sse("progress", {"phase": "analyst", "message": f"Answer comparison failed: {str(e)[:100]}"})

        # --- Step 6: Compute comparison ---
        yield _sse("progress", {"phase": "compare", "message": "Computing before/after comparison..."})

        # Build comparison from measured data. Both sides cover the same
        # prompts: the included evals (manual Explore-tab calls aren't part of
        # any), and both use the _total_context definition.
        from backend.routes.analysis import listing_tokens
        listings = await listing_tokens()
        baseline = _baseline_figures(included, listings)
        _, num_prompts = _baseline_population(session.eval_results, included)

        proxy_tokens_total = sum(t.get("tool_response_tokens_est", 0) for t in proxy_traces)
        proxy_calls = len(proxy_traces)
        proxy_errors = sum(1 for t in proxy_traces if t.get("error_category"))

        # Accuracy from analyst results
        analyst_correct, analyst_total = _accuracy_counts(analyst_results)
        accuracy = analyst_correct / analyst_total if analyst_total > 0 else None

        proxy_avg_latency = round(sum(t.get("tool_duration_s", 0) for t in proxy_traces) / num_prompts * 1000, 1) if proxy_traces else None
        proxy_avg = round(proxy_tokens_total / num_prompts, 1) if proxy_traces else None
        proxy_menu = proxy_menu_tokens + listings if proxy_menu_tokens > 0 else None
        # The proxy re-run used the enabled resources, condensed where condensed.
        proxy_resource_tokens = _resource_tokens(
            session.loaded_resources, condensed_resources, disabled_res_set,
        )
        proxy = {
            "tool_count": proxy_tool_count if proxy_tool_count > 0 else None,
            "menu_tokens": proxy_menu,
            "avg_tokens_per_prompt": proxy_avg,
            "avg_calls_per_prompt": round(proxy_calls / num_prompts, 1) if proxy_traces else None,
            "total_context": (
                _total_context(proxy_menu, proxy_resource_tokens, proxy_avg)
                if proxy_menu is not None and proxy_avg is not None else None
            ),
            "accuracy": accuracy,
            "avg_latency": proxy_avg_latency,
            "error_rate": round(proxy_errors / proxy_calls, 4) if proxy_calls else None,
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

        comparison = {"baseline": baseline, "proxy": proxy, "delta": delta, "analyst_results": analyst_results}
        if (delta.get("accuracy") or {}).get("value", 0) < 0:
            comparison["accuracy_warning"] = (
                f"Proxy answers diverged from baseline on {analyst_total - analyst_correct} "
                f"of {analyst_total} prompts"
            )
        if proxy_skip_reason:
            comparison["proxy_skip_reason"] = proxy_skip_reason

        # Create OptimizationRun
        session.run_counter += 1
        run_id = f"run_{session.run_counter}"
        run = OptimizationRun(
            id=run_id,
            timestamp=time.time(),
            name=f"Run {session.run_counter}",
            enabled_rec_ids=run_enabled_ids,
            enabled_recs=copy.deepcopy(filtered_recs + filtered_qws),
            proxy_code=proxy_code,
            comparison=comparison,
            proxy_answers=proxy_answers,
            analyst_results=analyst_results,
            condensed_resources=condensed_resources,
            skipped_recs=skipped_recs,
        )
        session.optimization_runs.append(run)

        yield _sse("progress", {"phase": "complete", "message": "Optimization complete!"})

        yield _sse("done", {
            "status": "complete",
            "runId": run_id,
            "recommendationCount": len(filtered_recs),
            "comparison": comparison,
            "proxyToolCount": proxy_tool_count,
            "baselineToolCount": len(session.tools),
            "skippedRecs": skipped_recs,
        })

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )




def _start_proxy() -> tuple[int, subprocess.Popen, Path]:
    """Start the saved proxy (<project>/proxy/server.py) on a random port.

    Returns (port, process, stderr_file).

    Hardened against the case where the proxy code was influenced by an
    untrusted MCP server. We:
      * Run in a new session/process group so a misbehaving child can't share
        terminal signals with the backend.
      * Scrub the environment to a minimal allowlist so a side-effecting
        import in the generated module can't read arbitrary secrets.
      * Pin cwd to the project root only because the proxy imports
        `backend.mcp_optimizer.proxy_runtime`.
    """
    # Find available port
    with socket.socket() as s:
        s.bind(("", 0))
        port = s.getsockname()[1]

    proxy_file = session.project_dir / "proxy" / "server.py"
    stderr_file = session.project_dir / "proxy" / "stderr.log"

    # Set cwd to project root so backend.mcp_optimizer imports work
    project_root = Path(__file__).resolve().parent.parent.parent

    # Minimal env: only what Python needs to start up and resolve our package.
    safe_env = {
        "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
        "HOME": os.environ.get("HOME", str(Path.home())),
        # project_root must stay first so `backend.*` resolves to this checkout.
        "PYTHONPATH": os.pathsep.join(filter(None, [str(project_root), os.environ.get("PYTHONPATH")])),
        "LANG": os.environ.get("LANG", "C.UTF-8"),
        "LC_ALL": os.environ.get("LC_ALL", "C.UTF-8"),
    }
    # Pass through virtualenv markers so `sys.executable` resolves correctly.
    for k in ("VIRTUAL_ENV", "PYENV_VERSION", "UV_CACHE_DIR"):
        if k in os.environ:
            safe_env[k] = os.environ[k]

    # The child inherits its own copy of the fd, so the parent's closes on exit
    # from the `with` — also when Popen raises.
    with open(stderr_file, "w") as err_fh:
        process = subprocess.Popen(
            [sys.executable, str(proxy_file), "--port", str(port)],
            stdout=subprocess.DEVNULL,
            stderr=err_fh,
            cwd=str(project_root),
            env=safe_env,
            start_new_session=True,
            close_fds=True,
        )

    return port, process, stderr_file


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




