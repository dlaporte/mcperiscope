from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from backend import mcp_manager
from backend.routes._common import (
    _analysis_stale,
    _baseline_figures,
    _get_visible_quick_wins,
    _live_eval_indices,
    _require_connected,
)
from backend.state import OptimizationRun, session

router = APIRouter()


@router.get("/results/recommendations")
async def get_recommendations():
    _require_connected()
    return {
        "recommendations": session.recommendations,
        "quickWins": _get_visible_quick_wins(),
        # True when there is no analysis or evals were added/deleted since;
        # the frontend then calls /optimize/analyze.
        "analysisStale": _analysis_stale(),
    }


def _get_run(run_id: str) -> OptimizationRun:
    """The run with this id, or a 404. Runs are snapshots: no connection needed."""
    run = next((r for r in session.optimization_runs if r.id == run_id), None)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    return run


def _report_prompts() -> list[str | None]:
    """session.prompts by eval index, with None for deleted evals."""
    live = set(_live_eval_indices())
    return [p if i in live else None for i, p in enumerate(session.prompts)]


def _build_report_data(run: OptimizationRun) -> dict:
    """Build the report_data dict expected by mcp_optimizer.report generators.

    The report shows this run's comparison, enabled recs and analyst results.
    """
    return {
        "url": mcp_manager.get_url() or "",
        "inventory": session.inventory or {},
        "analysis": session.analysis or {},
        "recommendations": run.enabled_recs,
        "traces": session.traces,
        "prompts": _report_prompts(),
        "comparison": run.comparison,
        "analyst_results": run.analyst_results,
    }


@router.get("/results/runs")
async def get_runs():
    return {"runs": [
        {"id": r.id, "timestamp": r.timestamp, "name": r.name, "enabledRecIds": r.enabled_rec_ids}
        for r in session.optimization_runs
    ]}


@router.get("/results/runs/{run_id}")
async def get_run(run_id: str):
    run = _get_run(run_id)
    return {
        "id": run.id, "timestamp": run.timestamp, "name": run.name,
        "enabledRecIds": run.enabled_rec_ids,
        "comparison": run.comparison, "analystResults": run.analyst_results,
        "proxyAnswers": run.proxy_answers,
        "condensedResources": {
            uri: {
                "name": c.get("name"),
                "original": c.get("original"),
                "condensed": c.get("condensed"),
                "originalTokens": c.get("original_tokens"),
                "condensedTokens": c.get("condensed_tokens"),
            }
            for uri, c in run.condensed_resources.items()
        },
        "skippedRecs": run.skipped_recs,
    }


@router.get("/results/runs/{run_id}/proxy")
async def get_run_proxy(run_id: str):
    run = next((r for r in session.optimization_runs if r.id == run_id), None)
    if not run or not run.proxy_code:
        raise HTTPException(status_code=404, detail="Proxy not found")
    return Response(content=run.proxy_code, media_type="text/plain")


@router.get("/results/runs/{run_id}/plan")
async def get_run_plan(run_id: str):
    run = _get_run(run_id)
    from backend.mcp_optimizer.report import generate_plan_md

    plan_md = generate_plan_md(
        url=mcp_manager.get_url() or "",
        inventory=session.inventory or {},
        recommendations=run.enabled_recs,  # this run's own snapshot
        traces=session.traces,
        prompts=_report_prompts(),
        filter_by_impact=False,  # the user already picked this run's recs
    )
    return Response(content=plan_md, media_type="text/markdown")


@router.get("/results/runs/{run_id}/report/html")
async def get_run_report_html(run_id: str):
    """HTML report of one run: its comparison, enabled recs and analyst results."""
    run = _get_run(run_id)
    from backend.mcp_optimizer.report import generate_report_html

    return Response(content=generate_report_html(_build_report_data(run)), media_type="text/html")


@router.get("/results/baseline")
async def get_baseline(included: str | None = None):
    """Baseline figures (same shape as a run's comparison["baseline"]).

    `included` is comma-separated eval indices; omitted means every live eval.
    Deleted and out-of-range indices are ignored.
    """
    _require_connected()
    live = set(_live_eval_indices())
    if included is None:
        indices = live
    else:
        try:
            indices = {int(x) for x in included.split(",") if x.strip()}
        except ValueError:
            raise HTTPException(status_code=400, detail="included must be comma-separated integers")
        indices &= live
    from backend.routes.analysis import listing_tokens

    return _baseline_figures(indices, await listing_tokens())
