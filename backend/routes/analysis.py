from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException

from backend.state import MODEL_CONTEXT_WINDOWS, session

logger = logging.getLogger(__name__)
from backend.mcp_optimizer.inventory import find_name_clusters, levenshtein, tool_token_budget

router = APIRouter()


def generate_quick_wins(
    tools: list,
    total_tokens: int,
    model: str,
    resources: list[dict] | None = None,
) -> list[dict]:
    """Generate static quick-win recommendations from tool and resource analysis.

    resources: optional list of dicts with keys: name, uri, mime_type, tokens, char_count
    """
    wins = []
    ctx_window = MODEL_CONTEXT_WINDOWS.get(model, session.custom_context_window or 200_000)
    context_pct = total_tokens / ctx_window * 100 if ctx_window else 0

    # High tool count
    if len(tools) > 50:
        wins.append({
            "type": "high_tool_count",
            "description": f"{len(tools)} tools — most LLMs perform best with fewer than 20. Consider consolidating related tools.",
            "tools": [],
            "estimated_savings": None,
        })

    # Context usage
    if context_pct > 15:
        wins.append({
            "type": "high_context_usage",
            "description": f"Tool definitions consume {context_pct:.1f}% of the context window ({total_tokens:,} tokens). Significant reduction possible.",
            "tools": [],
            "estimated_savings": None,
        })
    elif context_pct > 5:
        wins.append({
            "type": "moderate_context_usage",
            "description": f"Tool definitions use {context_pct:.1f}% of the context window ({total_tokens:,} tokens).",
            "tools": [],
            "estimated_savings": None,
        })

    # Consolidation opportunities (large prefix clusters)
    clusters = find_name_clusters(tools)
    large_clusters = [c for c in clusters if len(c.tools) >= 5]
    for cluster in large_clusters[:3]:
        wins.append({
            "type": "consolidation",
            "description": f"{len(cluster.tools)} tools share the '{cluster.prefix}' prefix — could be consolidated into a single tool with a type parameter.",
            "tools": cluster.tools,
            "estimated_savings": None,
        })

    # Oversized token budgets
    budgets = [(t, tool_token_budget(t)) for t in tools]
    oversized = [(t.name, b.total_tokens) for t, b in budgets if b.total_tokens > 300]
    if oversized:
        total_excess = sum(tokens - 100 for _, tokens in oversized)
        wins.append({
            "type": "oversized_schema",
            "description": f"{len(oversized)} tools have large token footprints (>300 tokens each). Trimming descriptions/schemas could save ~{total_excess:,} tokens.",
            "tools": [name for name, _ in oversized],
            "estimated_savings": total_excess,
        })

    # Missing descriptions
    missing_desc = [t.name for t in tools if not t.description]
    if missing_desc:
        wins.append({
            "type": "missing_description",
            "description": f"{len(missing_desc)} tools have no description — LLMs cannot effectively select them without descriptions.",
            "tools": missing_desc,
            "estimated_savings": None,
        })

    # Terse descriptions
    terse = [t.name for t in tools if t.description and len(t.description.strip()) < 20]
    if terse:
        wins.append({
            "type": "terse_description",
            "description": f"{len(terse)} tools have very short descriptions (<20 chars). Add return value info and usage examples.",
            "tools": terse,
            "estimated_savings": None,
        })

    # --- Resource analysis ---
    if resources:
        md_resources = [r for r in resources if r.get("mime_type") == "text/markdown"]
        total_resource_tokens = sum(r.get("tokens", 0) for r in md_resources)

        if md_resources and total_resource_tokens > 0:
            resource_pct = total_resource_tokens / ctx_window * 100 if ctx_window else 0
            # Overall resource token footprint
            if total_resource_tokens > 2000:
                wins.append({
                    "type": "resource_context_usage",
                    "description": (
                        f"{len(md_resources)} markdown resources consume ~{total_resource_tokens:,} tokens "
                        f"({resource_pct:.1f}% of context). "
                        f"These are loaded into context when referenced — consider trimming verbose content."
                    ),
                    "tools": [r["name"] for r in md_resources],
                    "estimated_savings": None,
                })

            # Flag individual large resources (>1000 tokens)
            large = [r for r in md_resources if r.get("tokens", 0) > 1000]
            if large:
                for r in sorted(large, key=lambda x: x.get("tokens", 0), reverse=True)[:5]:
                    wins.append({
                        "type": "large_resource",
                        "description": (
                            f"'{r['name']}' is ~{r['tokens']:,} tokens ({r['char_count']:,} chars). "
                            f"Consider trimming redundant sections, removing verbose examples, "
                            f"or splitting into smaller focused resources."
                        ),
                        "tools": [r["name"]],
                        "estimated_savings": r["tokens"] // 3,  # Estimate ~33% could be trimmed
                    })

            # Flag resources with duplicate/overlapping content patterns
            if len(md_resources) > 3:
                avg_tokens = total_resource_tokens // len(md_resources)
                if avg_tokens > 400:
                    wins.append({
                        "type": "resource_consolidation",
                        "description": (
                            f"{len(md_resources)} markdown resources averaging ~{avg_tokens} tokens each. "
                            f"Look for shared boilerplate (common headers, repeated tool references) "
                            f"that could be factored into a single shared resource."
                        ),
                        "tools": [r["name"] for r in md_resources],
                        "estimated_savings": None,
                    })

    return wins


@router.get("/analysis/inventory")
async def get_inventory():
    if not session.inventory:
        raise HTTPException(status_code=400, detail="Not connected or no inventory")

    ctx_window = MODEL_CONTEXT_WINDOWS.get(session.model, session.custom_context_window or 200_000)
    tool_budget = session.inventory.get("total_budget_tokens", 0)

    # Estimate resource and prompt definition tokens
    resource_tokens = 0
    prompt_tokens = 0
    resource_details: list[dict] = []  # For quick wins analysis

    from backend import mcp_manager
    if mcp_manager.is_connected():
        try:
            resources = await mcp_manager.list_resources()
            items = resources if isinstance(resources, list) else getattr(resources, "resources", [])
            for r in items:
                name = getattr(r, "name", "") or ""
                uri = str(getattr(r, "uri", ""))
                desc = getattr(r, "description", "") or ""
                mime_type = getattr(r, "mimeType", "") or ""
                def_tokens = max(1, len(f"{name}: {desc} ({uri})") // 4)
                resource_tokens += def_tokens

                # Read markdown resources to measure their content size
                if mime_type == "text/markdown":
                    try:
                        result = await mcp_manager.read_resource(uri)
                        contents = result if isinstance(result, list) else getattr(result, "contents", [])
                        text = ""
                        for c in contents:
                            text += getattr(c, "text", "") or ""
                        content_tokens = max(1, len(text) // 4)
                        resource_details.append({
                            "name": name,
                            "uri": uri,
                            "mime_type": mime_type,
                            "tokens": content_tokens,
                            "char_count": len(text),
                        })
                    except Exception:
                        logger.debug("Failed to read markdown resource content", exc_info=True)
        except Exception:
            logger.debug("Failed to list resources for inventory", exc_info=True)

        try:
            prompts = await mcp_manager.list_prompts()
            items = prompts if isinstance(prompts, list) else getattr(prompts, "prompts", [])
            for p in items:
                name = getattr(p, "name", "") or ""
                desc = getattr(p, "description", "") or ""
                args = getattr(p, "arguments", []) or []
                args_text = ", ".join(getattr(a, "name", "") for a in args)
                prompt_tokens += max(1, len(f"{name}({args_text}): {desc}") // 4)
        except Exception:
            logger.debug("Failed to list prompts for inventory", exc_info=True)

    total_budget = tool_budget + resource_tokens + prompt_tokens

    quick_wins = generate_quick_wins(session.tools, total_budget, session.model, resource_details)
    session.quick_wins = quick_wins

    return {
        **session.inventory,
        "totalBudgetTokens": total_budget,
        "toolTokens": tool_budget,
        "resourceTokens": resource_tokens,
        "promptTokens": prompt_tokens,
        "model": session.model,
        "contextWindow": ctx_window,
        "contextPct": round(total_budget / ctx_window * 100, 2) if ctx_window else 0,
        "quickWins": quick_wins,
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
    ctx_window = MODEL_CONTEXT_WINDOWS.get(session.model, session.custom_context_window or 200_000)

    return {
        "name": name,
        "description": tool.description,
        "descriptionTokens": budget.description_tokens,
        "schemaTokens": budget.schema_tokens,
        "totalTokens": budget.total_tokens,
        "contextPct": round(budget.total_tokens / ctx_window * 100, 3) if ctx_window else 0,
        "model": session.model,
        "contextWindow": ctx_window,
        "similarTools": similar,
        "cluster": cluster,
    }
