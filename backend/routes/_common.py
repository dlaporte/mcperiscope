"""Helpers shared by the API route modules."""

from __future__ import annotations

import json
from collections.abc import Iterable
from typing import Any

from backend.mcp_optimizer.inventory import estimate_tokens, tool_token_budget
from backend.state import session


def _sse(event: str, data: dict) -> str:
    """Format one Server-Sent Event."""
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


def _extract_fields(text: str) -> list[str]:
    """Extract top-level JSON keys from text (first item's keys for a list)."""
    try:
        data = json.loads(text)
        if isinstance(data, dict):
            return list(data.keys())
        elif isinstance(data, list) and data and isinstance(data[0], dict):
            return list(data[0].keys())
    except (json.JSONDecodeError, IndexError, TypeError):
        pass
    return []


def _menu_tokens(tools: list) -> int:
    """Estimated tokens the tool definitions (the "menu") add to every LLM call."""
    return sum(tool_token_budget(t).total_tokens for t in tools)


def _resource_tokens(
    resources: dict[str, dict],
    condensed: dict[str, dict] | None = None,
    disabled: Iterable[str] = (),
) -> int:
    """Content tokens of loaded resources (uri -> {tokens, ...}).

    Skips disabled URIs and counts the condensed text where one exists.
    """
    condensed = condensed or {}
    disabled = set(disabled)
    return sum(
        condensed[uri]["condensed_tokens"] if uri in condensed else r.get("tokens", 0)
        for uri, r in resources.items()
        if uri not in disabled
    )


def _total_context(menu_tokens: float, resource_tokens: float, avg_tokens_per_prompt: float) -> float:
    """Estimated context of one prompt; the one definition both sides use.

    menu (tool defs + resource/prompt listings) + loaded resource content +
    average tool-response tokens per prompt.
    """
    return round(menu_tokens + resource_tokens + avg_tokens_per_prompt, 1)


def _baseline_population(eval_results: list[dict], included: set[int]) -> tuple[list[dict], int]:
    """Baseline traces and prompt count for the before/after comparison.

    Covers only the included evals, matching what the proxy re-runs.
    Returns (trace events of those evals, number of included evals, min 1).
    """
    evals = [e for i, e in enumerate(eval_results) if i in included]
    traces = [t for e in evals for t in e.get("traceEvents", [])]
    return traces, max(len(evals), 1)


def _baseline_figures(included: set[int], listing_tokens: int) -> dict:
    """The baseline side of the comparison, over the included evals.

    `listing_tokens` is the resource + prompt definition tokens, so
    menu_tokens matches the inventory's totalBudgetTokens.
    """
    traces, num_prompts = _baseline_population(session.eval_results, included)
    calls = len(traces)
    errors = sum(1 for t in traces if t.get("error_category"))
    menu = _menu_tokens(session.tools) + listing_tokens
    avg_tokens = round(sum(t.get("tool_response_tokens_est", 0) for t in traces) / num_prompts, 1)
    return {
        "tool_count": len(session.tools),
        "menu_tokens": menu,
        "avg_tokens_per_prompt": avg_tokens,
        "avg_calls_per_prompt": round(calls / num_prompts, 1),
        # The baseline evals ran with every loaded resource, uncondensed.
        "total_context": _total_context(menu, _resource_tokens(session.loaded_resources), avg_tokens),
        "accuracy": 1.0,
        "avg_latency": round(sum(t.get("tool_duration_s", 0) for t in traces) / num_prompts * 1000, 1),
        "error_rate": round(errors / calls, 4) if calls else 0.0,
    }


def _make_trace_event(
    step: int,
    start: float,
    tool_name: str,
    tool_input: Any,
    result_text: str,
    duration: float,
    error: str | None = None,
    prompt_index: int | None = None,
) -> dict:
    """Build one tool-call trace event as consumed by mcp_optimizer.analyze.

    `prompt_index` is the eval index the call belongs to; None for manual
    (Explore tab) calls, which per-prompt analysis ignores.
    """
    return {
        "step": step,
        "prompt_index": prompt_index,
        "timestamp": start,
        "tool_name": tool_name,
        "tool_input": tool_input,
        "tool_response_chars": len(result_text),
        "tool_response_tokens_est": estimate_tokens(result_text),
        "tool_response_fields": _extract_fields(result_text),
        "tool_duration_s": round(duration, 3),
        "error_category": error if error else None,
    }


def _run_and_store_analysis() -> None:
    """Run trace analysis and store it, with stable rec IDs, on the session."""
    from backend.mcp_optimizer.analyze import run_analysis
    from backend.proxy_builder import mark_plan_only

    # session.ratings is positional and padded with None for unrated evals.
    ratings = [r for r in session.ratings if r is not None]
    session.analysis = run_analysis(session.tools, session.traces, ratings)
    session.recommendations = session.analysis.get("recommendations", [])
    for i, rec in enumerate(session.recommendations):
        rec["id"] = f"rec_{i}"
    mark_plan_only(session.recommendations)
