from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from backend.state import session

router = APIRouter()


def _require_connected():
    if not session.connection:
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
    return {"recommendations": session.recommendations}


def _build_report_data() -> dict:
    """Build the report_data dict expected by mcp_optimizer.report generators."""
    return {
        "url": session.connection.url if session.connection else "",
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
    from mcp_optimizer.report import generate_report_html

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
    from mcp_optimizer.report import generate_report_md

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
    from mcp_optimizer.report import generate_plan_md

    plan_md = generate_plan_md(session.recommendations)
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
