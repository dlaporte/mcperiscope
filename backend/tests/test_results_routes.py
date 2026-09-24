"""Results routes: per-run plan snapshot and Explore-tab trace errors."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

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
    assert trace["error_category"] == "bad input"
    assert trace["prompt_index"] is None
