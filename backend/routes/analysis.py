from __future__ import annotations

from fastapi import APIRouter, HTTPException

from backend.state import MODEL_CONTEXT_WINDOWS, session
from mcp_optimizer.inventory import find_name_clusters, levenshtein, tool_token_budget

router = APIRouter()


@router.get("/analysis/inventory")
async def get_inventory():
    if not session.inventory:
        raise HTTPException(status_code=400, detail="Not connected or no inventory")
    # Add context window info
    ctx_window = MODEL_CONTEXT_WINDOWS.get(session.model, 200_000)
    budget = session.inventory.get("total_budget_tokens", 0)
    return {
        **session.inventory,
        "model": session.model,
        "context_window": ctx_window,
        "context_pct": round(budget / ctx_window * 100, 2) if ctx_window else 0,
    }


@router.get("/analysis/tool/{name}")
async def get_tool_stats(name: str):
    if not session.tools:
        raise HTTPException(status_code=400, detail="Not connected")

    tool = next((t for t in session.tools if t.name == name), None)
    if not tool:
        raise HTTPException(status_code=404, detail=f"Tool '{name}' not found")

    budget = tool_token_budget(tool)

    # Similar tools (Levenshtein distance <= 3)
    similar = []
    for t in session.tools:
        if t.name != name:
            dist = levenshtein(t.name, name)
            if dist <= 3:
                similar.append({"name": t.name, "distance": dist})
    similar.sort(key=lambda x: x["distance"])

    # Cluster membership
    clusters = find_name_clusters(session.tools)
    cluster = None
    for c in clusters:
        if name in c.tools:
            cluster = {"prefix": c.prefix, "tools": c.tools, "count": len(c.tools)}
            break

    # Context window calculation
    ctx_window = MODEL_CONTEXT_WINDOWS.get(session.model, 200_000)

    return {
        "name": name,
        "description": tool.description,
        "description_tokens": budget.description_tokens,
        "schema_tokens": budget.schema_tokens,
        "total_tokens": budget.total_tokens,
        "context_pct": round(budget.total_tokens / ctx_window * 100, 3) if ctx_window else 0,
        "model": session.model,
        "context_window": ctx_window,
        "similar_tools": similar,
        "cluster": cluster,
    }
