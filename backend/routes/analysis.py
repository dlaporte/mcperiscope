from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException

from backend import mcp_manager
from backend.mcp_optimizer.inventory import (
    OVERSIZED_TOOL_TOKENS,
    TRIMMED_TOOL_TOKENS,
    estimate_tokens,
    find_name_clusters,
    similar_name_distance,
    tool_token_budget,
)
from backend.proxy_builder import mark_plan_only
from backend.routes._common import _require_connected
from backend.state import context_window_for, session

logger = logging.getLogger(__name__)

router = APIRouter()

# Estimated menu tokens of the single lookup(table) tool that replaces them
LOOKUP_TOOL_TOKENS = 50
# Markdown resources above this many tokens are worth condensing
CONDENSE_MIN_TOKENS = 500
# Condensing is expected to save about 1/N of a large resource's tokens
CONDENSE_SAVINGS_DIVISOR = 3


def generate_quick_wins(
    tools: list,
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
    ctx_window = context_window_for(model)

    # 1. Trim verbose descriptions — tools with oversized token footprints
    #    Action: use analyst LLM to rewrite descriptions more concisely
    budgets = [(t, tool_token_budget(t)) for t in tools]
    oversized = [(t.name, b.total_tokens, b.description_tokens) for t, b in budgets if b.total_tokens > OVERSIZED_TOOL_TOKENS]
    if oversized:
        total_excess = sum(tokens - TRIMMED_TOOL_TOKENS for _, tokens, _ in oversized)
        detail_lines = [f"  {name}: {tokens} tokens ({desc_tokens} description)" for name, tokens, desc_tokens in sorted(oversized, key=lambda x: -x[1])[:10]]
        wins.append({
            "type": "trim_descriptions",
            "description": (
                f"{len(oversized)} tools have token footprints over {OVERSIZED_TOOL_TOKENS} tokens each. "
                f"The analyst LLM will rewrite their descriptions to be more concise "
                f"while preserving tool selection accuracy.\n\n"
                + "\n".join(detail_lines)
            ),
            "tools": [name for name, _, _ in oversized],
            "estimated_savings": total_excess,
        })

    # 2. Remove unused tools — tools never called across all evaluation prompts
    #    Action: omit these tools from the proxy entirely
    #    Manual Explore-tab calls (prompt_index None) don't count as usage.
    eval_traces = [t for t in session.traces if t.get("prompt_index") is not None]
    if eval_traces:
        called_tools = {t.get("tool_name") for t in eval_traces}
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
                f"Consolidate into a single lookup(table) tool to save ~{no_param_tokens - LOOKUP_TOOL_TOKENS:,} menu tokens."
            ),
            "tools": no_param,
            "estimated_savings": max(0, no_param_tokens - LOOKUP_TOOL_TOKENS),
        })

    # 4. Condense resources — markdown resources loaded into context
    #    Action: use analyst LLM to condense resource content
    if resources:
        md_resources = [r for r in resources if r.get("mime_type") == "text/markdown"]
        total_resource_tokens = sum(r.get("tokens", 0) for r in md_resources)

        if md_resources and total_resource_tokens > CONDENSE_MIN_TOKENS:
            resource_pct = total_resource_tokens / ctx_window * 100 if ctx_window else 0
            large = sorted(
                [r for r in md_resources if r.get("tokens", 0) > CONDENSE_MIN_TOKENS],
                key=lambda x: x.get("tokens", 0),
                reverse=True,
            )
            detail_lines = [f"  {r['name']}: ~{r['tokens']:,} tokens" for r in large[:5]]
            estimated_savings = sum(r["tokens"] // CONDENSE_SAVINGS_DIVISOR for r in large) if large else None

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
    mark_plan_only(wins)

    return wins


async def _scan_resources() -> tuple[int, list[dict]]:
    """Return (resource definition tokens, markdown resource details for quick wins)."""
    resource_tokens = 0
    resource_details: list[dict] = []
    try:
        for r in await mcp_manager.list_resources():
            name = getattr(r, "name", "") or ""
            uri = str(getattr(r, "uri", ""))
            desc = getattr(r, "description", "") or ""
            mime_type = getattr(r, "mimeType", "") or ""
            resource_tokens += estimate_tokens(f"{name}: {desc} ({uri})")

            # Read markdown resources to measure their content size
            if mime_type == "text/markdown":
                try:
                    text = mcp_manager.extract_resource_text(await mcp_manager.read_resource(uri))
                    resource_details.append({
                        "name": name,
                        "uri": uri,
                        "mime_type": mime_type,
                        "tokens": estimate_tokens(text),
                        "char_count": len(text),
                    })
                except Exception:
                    logger.debug("Failed to read markdown resource content", exc_info=True)
    except Exception:
        logger.debug("Failed to list resources for inventory", exc_info=True)
    return resource_tokens, resource_details


async def _scan_prompts() -> int:
    """Return the prompt definition tokens."""
    prompt_tokens = 0
    try:
        for p in await mcp_manager.list_prompts():
            name = getattr(p, "name", "") or ""
            desc = getattr(p, "description", "") or ""
            args = getattr(p, "arguments", []) or []
            args_text = ", ".join(getattr(a, "name", "") for a in args)
            prompt_tokens += estimate_tokens(f"{name}({args_text}): {desc}")
    except Exception:
        logger.debug("Failed to list prompts for inventory", exc_info=True)
    return prompt_tokens


async def listing_tokens() -> int:
    """Resource + prompt definition tokens: the non-tool part of the menu.

    Tool menu tokens plus this equals the inventory's totalBudgetTokens.
    """
    if not mcp_manager.is_connected():
        return 0
    resource_tokens, _ = await _scan_resources()
    return resource_tokens + await _scan_prompts()


async def refresh_quick_wins() -> None:
    """Regenerate quick wins from the current traces and resources (new IDs)."""
    resource_details: list[dict] = []
    if mcp_manager.is_connected():
        _, resource_details = await _scan_resources()
    session.quick_wins = generate_quick_wins(session.tools, session.model, resource_details)


@router.get("/analysis/inventory")
async def get_inventory():
    _require_connected()
    if not session.inventory:
        raise HTTPException(status_code=400, detail="No inventory")

    ctx_window = context_window_for(session.model)
    tool_budget = session.inventory.get("total_budget_tokens", 0)

    # Estimate resource and prompt definition tokens
    resource_tokens = 0
    prompt_tokens = 0
    resource_details: list[dict] = []  # For quick wins analysis

    if mcp_manager.is_connected():
        resource_tokens, resource_details = await _scan_resources()
        prompt_tokens = await _scan_prompts()

    total_budget = tool_budget + resource_tokens + prompt_tokens

    # Only generate quick wins if not already set (preserves stable IDs across
    # optimize runs); /optimize/analyze refreshes them once traces exist.
    if not session.quick_wins:
        session.quick_wins = generate_quick_wins(session.tools, session.model, resource_details)

    return {
        **session.inventory,
        "totalBudgetTokens": total_budget,
        "toolTokens": tool_budget,
        "resourceTokens": resource_tokens,
        "promptTokens": prompt_tokens,
        "model": session.model,
        "contextWindow": ctx_window,
        "contextPct": round(total_budget / ctx_window * 100, 2) if ctx_window else 0,
        "quickWins": session.quick_wins,
    }


@router.get("/analysis/tool/{name}")
async def get_tool_stats(name: str):
    _require_connected()

    tool = next((t for t in session.tools if t.name == name), None)
    if not tool:
        raise HTTPException(status_code=404, detail=f"Tool '{name}' not found")

    budget = tool_token_budget(tool)

    # Similar tools (small Levenshtein distance)
    similar = []
    for t in session.tools:
        dist = similar_name_distance(t.name, name)
        if dist is not None:
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
    ctx_window = context_window_for(session.model)

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
