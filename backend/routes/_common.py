"""Helpers shared by the API route modules."""

from __future__ import annotations

import json
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


def _make_trace_event(
    step: int,
    start: float,
    tool_name: str,
    tool_input: Any,
    result_text: str,
    duration: float,
    error: str | None = None,
) -> dict:
    """Build one tool-call trace event as consumed by mcp_optimizer.analyze."""
    return {
        "step": step,
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

    session.analysis = run_analysis(session.tools, session.traces, [])
    session.recommendations = session.analysis.get("recommendations", [])
    for i, rec in enumerate(session.recommendations):
        rec["id"] = f"rec_{i}"
