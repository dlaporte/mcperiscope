from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from backend import mcp_manager
from backend.state import session

router = APIRouter()


def _require_connected():
    if not mcp_manager.is_connected():
        raise HTTPException(status_code=400, detail="Not connected")


@router.get("/results/comparison")
async def get_comparison():
    _require_connected()
    if not session.comparison:
        raise HTTPException(
            status_code=400,
            detail="No comparison data available. Run optimization first.",
        )
    return session.comparison


@router.get("/results/recommendations")
async def get_recommendations():
    _require_connected()
    return {"recommendations": session.recommendations, "quickWins": session.quick_wins}


def _build_report_data() -> dict:
    """Build the report_data dict expected by mcp_optimizer.report generators."""
    return {
        "url": mcp_manager.get_url() or "",
        "inventory": session.inventory,
        "analysis": session.analysis,
        "recommendations": session.recommendations,
        "ratings": session.ratings,
        "traces": session.traces,
        "prompts": session.prompts,
        "baseline_results": [],
    }


@router.get("/results/report/html")
async def get_report_html():
    _require_connected()
    if not session.analysis:
        raise HTTPException(
            status_code=400,
            detail="No analysis data available. Run optimization first.",
        )
    from backend.mcp_optimizer.report import generate_report_html

    report_data = _build_report_data()
    html_content = generate_report_html(report_data)
    return Response(content=html_content, media_type="text/html")


@router.get("/results/report/md")
async def get_report_md():
    _require_connected()
    if not session.analysis:
        raise HTTPException(
            status_code=400,
            detail="No analysis data available. Run optimization first.",
        )
    from backend.mcp_optimizer.report import generate_report_md

    report_data = _build_report_data()
    md_content = generate_report_md(report_data)
    return Response(content=md_content, media_type="text/markdown")


@router.get("/results/plan")
async def get_plan():
    _require_connected()
    if not session.recommendations:
        raise HTTPException(
            status_code=400,
            detail="No recommendations available. Run optimization first.",
        )
    from backend.mcp_optimizer.report import generate_plan_md

    plan_md = generate_plan_md(
        url=mcp_manager.get_url() or "",
        inventory=session.inventory or {},
        analysis=session.analysis or {},
        recommendations=session.recommendations,
        ratings=session.ratings,
        traces=session.traces,
        prompts=session.prompts,
    )
    return Response(content=plan_md, media_type="text/markdown")


@router.get("/results/proxy")
async def get_proxy():
    _require_connected()
    if not session.proxy_code:
        raise HTTPException(
            status_code=400,
            detail="No proxy code available. Run optimization first.",
        )
    return Response(content=session.proxy_code, media_type="text/plain")


@router.get("/results/runs")
async def get_runs():
    return {"runs": [
        {"id": r.id, "timestamp": r.timestamp, "name": r.name, "enabledRecIds": r.enabled_rec_ids}
        for r in session.optimization_runs
    ]}


@router.get("/results/runs/{run_id}")
async def get_run(run_id: str):
    run = next((r for r in session.optimization_runs if r.id == run_id), None)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    return {
        "id": run.id, "timestamp": run.timestamp, "name": run.name,
        "enabledRecIds": run.enabled_rec_ids,
        "comparison": run.comparison, "analystResults": run.analyst_results,
        "proxyAnswers": run.proxy_answers,
    }


@router.get("/results/runs/{run_id}/proxy")
async def get_run_proxy(run_id: str):
    run = next((r for r in session.optimization_runs if r.id == run_id), None)
    if not run or not run.proxy_code:
        raise HTTPException(status_code=404, detail="Proxy not found")
    return Response(content=run.proxy_code, media_type="text/plain")


@router.get("/results/runs/{run_id}/plan")
async def get_run_plan(run_id: str):
    _require_connected()
    run = next((r for r in session.optimization_runs if r.id == run_id), None)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    # Filter recommendations to this run's enabled set
    enabled_set = set(run.enabled_rec_ids)
    recs = [r for r in session.recommendations if r.get("id") in enabled_set]
    qws = [q for q in session.quick_wins if q.get("id") in enabled_set]
    from backend.mcp_optimizer.report import generate_plan_md

    plan_md = generate_plan_md(
        url=mcp_manager.get_url() or "",
        inventory=session.inventory or {},
        analysis=session.analysis or {},
        recommendations=recs + qws,
        ratings=session.ratings,
        traces=session.traces,
        prompts=session.prompts,
    )
    return Response(content=plan_md, media_type="text/markdown")
