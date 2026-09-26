"""Results routes (runs, reports, baseline, staleness) and related request handling."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from backend import mcp_manager
from backend.models import ToolCallRequest
from backend.routes import results, tools
from backend.state import OptimizationRun, session


def test_run_plan_uses_run_snapshot_not_current_recs(monkeypatch):
    monkeypatch.setattr(mcp_manager, "is_connected", lambda: True)
    monkeypatch.setattr(session, "inventory", {"tool_count": 3})
    run = OptimizationRun(
        id="run_1", timestamp=0.0, name="Run 1", enabled_rec_ids=["rec_0"],
        enabled_recs=[{"id": "rec_0", "type": "remove", "description": "original rec", "source_tools": ["a"]}],
    )
    monkeypatch.setattr(session, "optimization_runs", [run])
    # A re-analyze reassigned rec_0 to a different rec.
    monkeypatch.setattr(session, "recommendations", [{"id": "rec_0", "type": "consolidate", "description": "new rec"}])

    body = asyncio.run(results.get_run_plan("run_1")).body.decode()
    assert "original rec" in body and "new rec" not in body


def test_manual_tool_error_is_recorded(monkeypatch):
    async def call_tool(name, arguments):
        return SimpleNamespace(content=[SimpleNamespace(text="bad input")], isError=True)

    monkeypatch.setattr(mcp_manager, "is_connected", lambda: True)
    monkeypatch.setattr(mcp_manager, "call_tool", call_tool)
    monkeypatch.setattr(session, "traces", [])
    resp = asyncio.run(tools.call_tool(ToolCallRequest(name="t", arguments={})))
    assert resp["isError"] is True
    trace = session.traces[0]
    assert trace["step"] == 1  # manual calls count from 1, like agent loops
    assert trace["error_category"] == "bad input"
    assert trace["prompt_index"] is None


def test_analyze_rejects_manual_traces_only(monkeypatch):
    from backend.routes import optimize

    monkeypatch.setattr(mcp_manager, "is_connected", lambda: True)
    monkeypatch.setattr(session, "traces", [{"tool_name": "t", "prompt_index": None}])
    with pytest.raises(HTTPException) as excinfo:
        asyncio.run(optimize.analyze_tools())
    assert excinfo.value.status_code == 400


def test_run_optimize_analyst_inherit_clears_analyst_fields(monkeypatch, clean_session):
    from backend.routes import optimize

    monkeypatch.setattr(mcp_manager, "is_connected", lambda: True)
    for k, v in {
        "api_key": "k", "api_key_provider": "anthropic", "analyst_model": "m", "analyst_provider": "custom",
        "analyst_endpoint": "https://llm.example/v1", "analyst_api_key": "ak",
        "analyst_api_key_provider": "custom", "analyst_api_key_endpoint": "https://llm.example/v1",
    }.items():
        setattr(session, k, v)
    req = optimize.OptimizeRunRequest(analyst_inherit=True, analyst_api_key="ignored", custom_context_window=64_000)
    with pytest.raises(HTTPException) as excinfo:  # no evals: rejected after binding
        asyncio.run(optimize.run_optimize(req))
    assert excinfo.value.status_code == 400
    assert (session.analyst_model, session.analyst_provider, session.analyst_endpoint,
            session.analyst_api_key, session.analyst_api_key_provider,
            session.analyst_api_key_endpoint) == ("",) * 6
    assert session.custom_context_window == 64_000


def test_custom_context_window_bounds():
    from pydantic import ValidationError

    from backend.models import EvaluateRequest, OAuthCallbackRequest

    assert EvaluateRequest(prompt="p", custom_context_window=500_000).custom_context_window == 500_000
    for bad in (0, 3_000_000):
        with pytest.raises(ValidationError):
            EvaluateRequest(prompt="p", custom_context_window=bad)
        with pytest.raises(ValidationError):
            OAuthCallbackRequest(callback_url="x", custom_context_window=bad)


def test_get_run_shape(monkeypatch):
    run = OptimizationRun(
        id="run_1", timestamp=1.0, name="Run 1", enabled_rec_ids=["rec_0"],
        comparison={"baseline": {}, "proxy": {}}, analyst_results=[{"verdict": "equivalent"}],
        proxy_answers=[{"index": 0, "answer": "a"}],
        condensed_resources={"r://a": {"name": "A", "original": "long", "condensed": "short",
                                       "original_tokens": 100, "condensed_tokens": 40}},
        skipped_recs=[{"id": "qw_1", "type": "trim_descriptions", "reason": "r"}],
    )
    monkeypatch.setattr(session, "optimization_runs", [run])
    body = asyncio.run(results.get_run("run_1"))
    assert set(body) == {"id", "timestamp", "name", "enabledRecIds", "comparison", "analystResults",
                         "proxyAnswers", "condensedResources", "skippedRecs"}
    assert body["condensedResources"] == {"r://a": {
        "name": "A", "original": "long", "condensed": "short",
        "originalTokens": 100, "condensedTokens": 40,
    }}


def test_run_report_html_uses_run_snapshot(monkeypatch):
    run = OptimizationRun(
        id="run_1", timestamp=0.0, name="Run 1",
        enabled_recs=[{"id": "rec_0", "type": "remove", "description": "snapshot rec", "source_tools": ["a"]}],
        comparison={"baseline": {"accuracy": 1.0}, "proxy": {"accuracy": 0.75}, "delta": {}},
        analyst_results=[{"index": 0, "prompt": "p", "verdict": "partial", "explanation": "missing a field"}],
    )
    monkeypatch.setattr(mcp_manager, "is_connected", lambda: False)  # no connection needed
    monkeypatch.setattr(session, "optimization_runs", [run])
    monkeypatch.setattr(session, "recommendations", [{"id": "rec_0", "description": "current rec"}])
    monkeypatch.setattr(session, "prompts", ["p"])
    monkeypatch.setattr(session, "eval_results", [{"prompt": "p"}])
    monkeypatch.setattr(session, "traces", [])
    body = asyncio.run(results.get_run_report_html("run_1")).body.decode()
    assert "snapshot rec" in body and "current rec" not in body
    assert "missing a field" in body and ">75%<" in body
    with pytest.raises(HTTPException):
        asyncio.run(results.get_run_report_html("nope"))


def test_analysis_stale_flag(monkeypatch):
    from backend.routes._common import _run_and_store_analysis

    monkeypatch.setattr(mcp_manager, "is_connected", lambda: True)
    monkeypatch.setattr(session, "tools", [])
    monkeypatch.setattr(session, "traces", [])
    monkeypatch.setattr(session, "quick_wins", [])
    monkeypatch.setattr(session, "loaded_resources", {})
    monkeypatch.setattr(session, "analysis", None)
    monkeypatch.setattr(session, "eval_results", [{"prompt": "a"}])
    assert asyncio.run(results.get_recommendations())["analysisStale"] is True
    _run_and_store_analysis()
    assert asyncio.run(results.get_recommendations())["analysisStale"] is False
    session.eval_results.append({"prompt": "b"})
    assert asyncio.run(results.get_recommendations())["analysisStale"] is True
    _run_and_store_analysis()
    session.eval_results[0]["deleted"] = True
    assert asyncio.run(results.get_recommendations())["analysisStale"] is True


def test_baseline_route_matches_helper(monkeypatch):
    from backend.routes import analysis
    from backend.routes._common import _baseline_figures

    trace = {"tool_response_tokens_est": 10, "tool_duration_s": 0.1, "error_category": None}

    async def no_listings():
        return 3

    monkeypatch.setattr(mcp_manager, "is_connected", lambda: True)
    monkeypatch.setattr(analysis, "listing_tokens", no_listings)
    monkeypatch.setattr(session, "tools", [])
    monkeypatch.setattr(session, "loaded_resources", {})
    monkeypatch.setattr(session, "eval_results", [
        {"traceEvents": [trace]}, {"traceEvents": [trace] * 3, "deleted": True}, {"traceEvents": [trace] * 2},
    ])
    assert asyncio.run(results.get_baseline(None)) == _baseline_figures({0, 2}, 3)
    assert asyncio.run(results.get_baseline("0,1")) == _baseline_figures({0}, 3)
    assert asyncio.run(results.get_baseline("2"))["avg_calls_per_prompt"] == 2.0
    with pytest.raises(HTTPException):
        asyncio.run(results.get_baseline("x"))
