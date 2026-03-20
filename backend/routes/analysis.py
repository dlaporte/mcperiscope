from __future__ import annotations

from fastapi import APIRouter, HTTPException

from backend.state import MODEL_CONTEXT_WINDOWS, session
from mcp_optimizer.inventory import find_name_clusters, levenshtein, tool_token_budget

router = APIRouter()


@router.get("/analysis/inventory")
async def get_inventory():
    if not session.inventory:
        raise HTTPException(status_code=400, detail="Not connected or no inventory")

    ctx_window = MODEL_CONTEXT_WINDOWS.get(session.model, 200_000)
    tool_budget = session.inventory.get("total_budget_tokens", 0)

    # Estimate resource and prompt definition tokens
    resource_tokens = 0
    prompt_tokens = 0
    if session.connection and session.connection.connected:
        try:
            resources = await session.connection._client.list_resources()
            items = resources if isinstance(resources, list) else getattr(resources, "resources", [])
            for r in items:
                name = getattr(r, "name", "") or ""
                uri = str(getattr(r, "uri", ""))
                desc = getattr(r, "description", "") or ""
                resource_tokens += max(1, len(f"{name}: {desc} ({uri})") // 4)
        except Exception:
            pass

        try:
            prompts = await session.connection._client.list_prompts()
            items = prompts if isinstance(prompts, list) else getattr(prompts, "prompts", [])
            for p in items:
                name = getattr(p, "name", "") or ""
                desc = getattr(p, "description", "") or ""
                args = getattr(p, "arguments", []) or []
                args_text = ", ".join(getattr(a, "name", "") for a in args)
                prompt_tokens += max(1, len(f"{name}({args_text}): {desc}") // 4)
        except Exception:
            pass

    total_budget = tool_budget + resource_tokens + prompt_tokens

    return {
        **session.inventory,
        "total_budget_tokens": total_budget,
        "tool_tokens": tool_budget,
        "resource_tokens": resource_tokens,
        "prompt_tokens": prompt_tokens,
        "model": session.model,
        "context_window": ctx_window,
        "context_pct": round(total_budget / ctx_window * 100, 2) if ctx_window else 0,
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
