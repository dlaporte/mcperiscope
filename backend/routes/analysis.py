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
    """Generate discrete, non-overlapping recommendations from inventory analysis.

    Each recommendation has a specific, well-defined remediation action.
    Behavior-based recommendations (from run_analysis) handle consolidation
    and description rewrites — inventory recommendations cover what behavior
    analysis cannot detect statically.
    """
    wins = []
    ctx_window = MODEL_CONTEXT_WINDOWS.get(model, session.custom_context_window or 200_000)

    # 1. Trim verbose descriptions — tools with oversized token footprints
    #    Action: use analyst LLM to rewrite descriptions more concisely
    budgets = [(t, tool_token_budget(t)) for t in tools]
    oversized = [(t.name, b.total_tokens, b.description_tokens) for t, b in budgets if b.total_tokens > 300]
    if oversized:
        total_excess = sum(tokens - 100 for _, tokens, _ in oversized)
        detail_lines = [f"  {name}: {tokens} tokens ({desc_tokens} description)" for name, tokens, desc_tokens in sorted(oversized, key=lambda x: -x[1])[:10]]
        wins.append({
            "type": "trim_descriptions",
            "description": (
                f"{len(oversized)} tools have token footprints over 300 tokens each. "
                f"The analyst LLM will rewrite their descriptions to be more concise "
                f"while preserving tool selection accuracy.\n\n"
                + "\n".join(detail_lines)
            ),
            "tools": [name for name, _, _ in oversized],
            "estimated_savings": total_excess,
        })

    # 2. Remove unused tools — tools never called across all evaluation prompts
    #    Action: omit these tools from the proxy entirely
    if session.traces:
        called_tools = {t.get("tool_name") for t in session.traces}
        all_tool_names = {t.name for t in tools}
        unused = sorted(all_tool_names - called_tools)
        if unused and len(unused) < len(tools):  # Don't remove all tools
            unused_tokens = sum(
                b.total_tokens for t, b in budgets if t.name in unused
            )
            wins.append({
                "type": "remove_unused",
                "description": (
                    f"{len(unused)} tools were never called during evaluation. "
                    f"Removing them from the proxy saves ~{unused_tokens:,} menu tokens."
                ),
                "tools": list(unused),
                "estimated_savings": unused_tokens,
            })

    # 3. Consolidate no-parameter lookup tools — tools with no inputs
    #    Action: merge into a single lookup(table) tool
    no_param = []
    for t in tools:
        schema = t.inputSchema or {}
        props = schema.get("properties", {})
        required = schema.get("required", [])
        if not props and not required:
            no_param.append(t.name)
    if len(no_param) >= 3:
        no_param_tokens = sum(b.total_tokens for t, b in budgets if t.name in no_param)
        wins.append({
            "type": "consolidate_lookups",
            "description": (
                f"{len(no_param)} tools take no parameters (reference data lookups). "
                f"Consolidate into a single lookup(table) tool to save ~{no_param_tokens - 50:,} menu tokens."
            ),
            "tools": no_param,
            "estimated_savings": max(0, no_param_tokens - 50),
        })

    # 4. Condense resources — markdown resources loaded into context
    #    Action: use analyst LLM to condense resource content
    if resources:
        md_resources = [r for r in resources if r.get("mime_type") == "text/markdown"]
        total_resource_tokens = sum(r.get("tokens", 0) for r in md_resources)

        if md_resources and total_resource_tokens > 500:
            resource_pct = total_resource_tokens / ctx_window * 100 if ctx_window else 0
            large = sorted(
                [r for r in md_resources if r.get("tokens", 0) > 500],
                key=lambda x: x.get("tokens", 0),
                reverse=True,
            )
            detail_lines = [f"  {r['name']}: ~{r['tokens']:,} tokens" for r in large[:5]]
            estimated_savings = sum(r["tokens"] // 3 for r in large) if large else None

            description = (
                f"{len(md_resources)} markdown resources consume ~{total_resource_tokens:,} tokens "
                f"({resource_pct:.1f}% of context). "
                f"The analyst LLM will condense content while preserving key information."
            )
            if detail_lines:
                description += "\n\n" + "\n".join(detail_lines)

            wins.append({
                "type": "resource_context_usage",
                "description": description,
                "tools": [r["name"] for r in md_resources],
                "estimated_savings": estimated_savings,
            })

    # Assign unique IDs
    for i, win in enumerate(wins):
        win["id"] = f"qw_{i}"

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
