"""Analyze an MCP server's tool inventory immediately after connection.

Takes a list of mcp.types.Tool objects and produces a structured analysis
covering token budgets, name clustering, similar-name detection, and
actionable quick wins for optimization.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from itertools import combinations

from mcp.types import Tool


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------


@dataclass
class ToolBudgetEntry:
    name: str
    description_tokens: int
    schema_tokens: int
    total_tokens: int


@dataclass
class NameCluster:
    prefix: str
    tools: list[str]


@dataclass
class SimilarPair:
    tool_a: str
    tool_b: str
    distance: int


@dataclass
class QuickWin:
    type: str  # "consolidation", "duplicate", "oversized_schema"
    description: str
    tools: list[str]
    estimated_savings: int  # tokens


@dataclass
class InventoryAnalysis:
    tool_count: int
    total_budget_tokens: int
    budget_assessment: str
    tool_budgets: list[ToolBudgetEntry]  # sorted by total_tokens desc
    name_clusters: list[NameCluster]
    similar_pairs: list[SimilarPair]
    quick_wins: list[QuickWin]


# ---------------------------------------------------------------------------
# Token estimation
# ---------------------------------------------------------------------------


def estimate_tokens(text: str) -> int:
    """Rough token estimate: len(text) // 4."""
    return max(1, len(text) // 4)


# ---------------------------------------------------------------------------
# Per-tool budget
# ---------------------------------------------------------------------------


def tool_token_budget(tool: Tool) -> ToolBudgetEntry:
    """Calculate token cost of a single tool definition."""
    desc_text = tool.description or ""
    schema_text = json.dumps(tool.inputSchema) if tool.inputSchema else ""
    # Include tool name in budget
    name_and_desc = f"{tool.name}: {desc_text}"
    desc_tokens = estimate_tokens(name_and_desc)
    schema_tokens = estimate_tokens(schema_text)
    return ToolBudgetEntry(
        name=tool.name,
        description_tokens=desc_tokens,
        schema_tokens=schema_tokens,
        total_tokens=desc_tokens + schema_tokens,
    )


# ---------------------------------------------------------------------------
# Levenshtein distance
# ---------------------------------------------------------------------------


def levenshtein(a: str, b: str) -> int:
    """Standard dynamic-programming Levenshtein distance."""
    if a == b:
        return 0
    len_a, len_b = len(a), len(b)
    if len_a == 0:
        return len_b
    if len_b == 0:
        return len_a

    # Use two-row optimisation to save memory.
    prev = list(range(len_b + 1))
    curr = [0] * (len_b + 1)

    for i in range(1, len_a + 1):
        curr[0] = i
        for j in range(1, len_b + 1):
            cost = 0 if a[i - 1] == b[j - 1] else 1
            curr[j] = min(
                prev[j] + 1,       # deletion
                curr[j - 1] + 1,   # insertion
                prev[j - 1] + cost, # substitution
            )
        prev, curr = curr, prev

    return prev[len_b]


# ---------------------------------------------------------------------------
# Name clustering
# ---------------------------------------------------------------------------

_CAMEL_BOUNDARY = re.compile(r"(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])")


def _extract_prefix(name: str) -> str:
    """Return the first logical word of a tool name.

    Splits on underscores first; if none are found, splits on camelCase
    boundaries.  Returns the prefix lowercased for grouping purposes.
    """
    if "_" in name:
        return name.split("_", 1)[0].lower()
    parts = _CAMEL_BOUNDARY.split(name)
    if parts:
        return parts[0].lower()
    return name.lower()


def find_name_clusters(tools: list[Tool], min_cluster_size: int = 2) -> list[NameCluster]:
    """Group tools by common prefix (split on ``_`` or camelCase boundaries)."""
    groups: dict[str, list[str]] = {}
    for tool in tools:
        prefix = _extract_prefix(tool.name)
        groups.setdefault(prefix, []).append(tool.name)

    clusters = [
        NameCluster(prefix=prefix, tools=sorted(names))
        for prefix, names in groups.items()
        if len(names) >= min_cluster_size
    ]
    # Sort by cluster size descending, then prefix alphabetically.
    clusters.sort(key=lambda c: (-len(c.tools), c.prefix))
    return clusters


# ---------------------------------------------------------------------------
# Similar-name detection
# ---------------------------------------------------------------------------


def find_similar_pairs(tools: list[Tool], max_distance: int = 3) -> list[SimilarPair]:
    """Find tool name pairs with Levenshtein distance <= *max_distance*.

    Identical names (distance 0) are excluded since they would be the same
    tool.
    """
    pairs: list[SimilarPair] = []
    names = [t.name for t in tools]
    for a, b in combinations(names, 2):
        # Quick length-difference prune — if lengths differ by more than
        # max_distance they can never be within range.
        if abs(len(a) - len(b)) > max_distance:
            continue
        dist = levenshtein(a, b)
        if 0 < dist <= max_distance:
            pairs.append(SimilarPair(tool_a=a, tool_b=b, distance=dist))

    pairs.sort(key=lambda p: (p.distance, p.tool_a, p.tool_b))
    return pairs


# ---------------------------------------------------------------------------
# Quick wins
# ---------------------------------------------------------------------------


def find_quick_wins(
    tools: list[Tool],
    clusters: list[NameCluster],
    budgets: list[ToolBudgetEntry],
) -> list[QuickWin]:
    """Identify obvious optimisation opportunities."""
    quick_wins: list[QuickWin] = []
    budget_by_name: dict[str, ToolBudgetEntry] = {b.name: b for b in budgets}

    # 1. Large clusters that could be consolidated
    for cluster in clusters:
        if len(cluster.tools) >= 4:
            savings = sum(
                budget_by_name[n].total_tokens
                for n in cluster.tools[1:]
                if n in budget_by_name
            )
            quick_wins.append(
                QuickWin(
                    type="consolidation",
                    description=(
                        f"{len(cluster.tools)} tools with prefix '{cluster.prefix}' "
                        f"could be consolidated into 1 parameterised tool"
                    ),
                    tools=cluster.tools,
                    estimated_savings=savings,
                )
            )

    # 2. Tools with identical input schemas (potential duplicates)
    schema_groups: dict[str, list[str]] = {}
    for tool in tools:
        key = json.dumps(tool.inputSchema, sort_keys=True) if tool.inputSchema else ""
        if key:
            schema_groups.setdefault(key, []).append(tool.name)

    for _schema_key, names in schema_groups.items():
        if len(names) >= 2:
            # Estimate savings: removing all but one copy
            savings = sum(
                budget_by_name[n].total_tokens
                for n in names[1:]
                if n in budget_by_name
            )
            quick_wins.append(
                QuickWin(
                    type="duplicate",
                    description=(
                        f"{len(names)} tools share an identical input schema "
                        f"and may be duplicates: {', '.join(sorted(names))}"
                    ),
                    tools=sorted(names),
                    estimated_savings=savings,
                )
            )

    # 3. Oversized schemas (>500 tokens)
    for b in budgets:
        if b.schema_tokens > 500:
            quick_wins.append(
                QuickWin(
                    type="oversized_schema",
                    description=f"Tool '{b.name}' has a large schema ({b.schema_tokens} tokens)",
                    tools=[b.name],
                    estimated_savings=0,
                )
            )

    # 4. High tool count
    tool_count = len(tools)
    if tool_count > 30:
        quick_wins.insert(0, QuickWin(
            type="high_tool_count",
            description=(
                f"This MCP exposes {tool_count} tools — most LLMs perform best "
                f"with fewer than 20. Each tool definition consumes context window "
                f"space on every API call, even when unused. Consider consolidating "
                f"related tools or removing rarely-used ones."
            ),
            tools=[],
            estimated_savings=0,
        ))
    elif tool_count > 20:
        quick_wins.insert(0, QuickWin(
            type="high_tool_count",
            description=(
                f"This MCP exposes {tool_count} tools — above the recommended "
                f"limit of 20 for optimal LLM tool selection accuracy."
            ),
            tools=[],
            estimated_savings=0,
        ))

    # 5. High context window usage
    total_tokens = sum(b.total_tokens for b in budgets)
    # Check against common context windows (200K for Claude, 128K for GPT-4o)
    for model_name, ctx_size in [("Claude (200K)", 200_000), ("GPT-4o (128K)", 128_000)]:
        pct = total_tokens / ctx_size * 100
        if pct > 15:
            quick_wins.insert(0, QuickWin(
                type="high_context_usage",
                description=(
                    f"Tool definitions consume {total_tokens:,} tokens — "
                    f"{pct:.1f}% of {model_name}'s context window. "
                    f"This leaves significantly less room for conversation history "
                    f"and tool responses. Consolidating or trimming tool definitions "
                    f"would free up context for actual work."
                ),
                tools=[],
                estimated_savings=0,
            ))
            break  # Only show the worst case
        elif pct > 5:
            quick_wins.insert(0, QuickWin(
                type="moderate_context_usage",
                description=(
                    f"Tool definitions consume {total_tokens:,} tokens — "
                    f"{pct:.1f}% of {model_name}'s context window. "
                    f"This is noticeable overhead that could be reduced by "
                    f"consolidating lookup tools or trimming verbose descriptions."
                ),
                tools=[],
                estimated_savings=0,
            ))
            break

    # 6. Description quality issues
    _RETURN_KEYWORDS = {"return", "returns", "response", "provides", "includes", "output", "gives", "contains"}
    _GUIDANCE_KEYWORDS = {"use this", "use when", "use for", "instead of", "unlike", "prefer", "rather than"}

    missing_desc: list[str] = []
    terse_desc: list[str] = []
    no_return_info: list[str] = []
    duplicate_descs: dict[str, list[str]] = {}

    for tool in tools:
        desc = (tool.description or "").strip()

        if not desc:
            missing_desc.append(tool.name)
            continue

        if len(desc) < 30:
            terse_desc.append(tool.name)

        desc_lower = desc.lower()
        if not any(kw in desc_lower for kw in _RETURN_KEYWORDS):
            no_return_info.append(tool.name)

        # Track duplicate descriptions
        duplicate_descs.setdefault(desc, []).append(tool.name)

    if missing_desc:
        quick_wins.append(QuickWin(
            type="missing_description",
            description=(
                f"{len(missing_desc)} tool(s) have no description at all. "
                f"Without a description, the LLM can only guess what a tool does "
                f"from its name, leading to incorrect tool selection."
            ),
            tools=missing_desc,
            estimated_savings=0,
        ))

    if terse_desc:
        quick_wins.append(QuickWin(
            type="terse_description",
            description=(
                f"{len(terse_desc)} tool(s) have very short descriptions (<30 chars). "
                f"Brief descriptions make it harder for the LLM to distinguish "
                f"between similar tools. Adding detail about what the tool returns "
                f"and when to use it improves selection accuracy."
            ),
            tools=terse_desc,
            estimated_savings=0,
        ))

    # Only flag missing return info if it's a significant portion
    if no_return_info and len(no_return_info) > len(tools) * 0.3:
        quick_wins.append(QuickWin(
            type="no_return_info",
            description=(
                f"{len(no_return_info)} of {len(tools)} tools don't describe what they return. "
                f"Descriptions that include return value details (e.g., 'Returns a list of "
                f"scout names and ranks') help the LLM decide which tool to call and "
                f"how to interpret the result."
            ),
            tools=no_return_info,
            estimated_savings=0,
        ))

    # Duplicate descriptions
    dup_groups = [(desc, names) for desc, names in duplicate_descs.items() if len(names) >= 2]
    if dup_groups:
        all_dup_tools = []
        for _desc, names in dup_groups:
            all_dup_tools.extend(names)
        quick_wins.append(QuickWin(
            type="duplicate_description",
            description=(
                f"{len(dup_groups)} group(s) of tools share identical descriptions. "
                f"When multiple tools have the same description, the LLM cannot "
                f"distinguish between them and will pick arbitrarily. Each tool "
                f"should explain what makes it unique."
            ),
            tools=all_dup_tools,
            estimated_savings=0,
        ))

    return quick_wins


# ---------------------------------------------------------------------------
# Main analysis entry point
# ---------------------------------------------------------------------------


def analyze_inventory(tools: list[Tool]) -> InventoryAnalysis:
    """Run full inventory analysis on a list of tools."""
    budgets = [tool_token_budget(t) for t in tools]
    budgets.sort(key=lambda b: b.total_tokens, reverse=True)
    total = sum(b.total_tokens for b in budgets)

    clusters = find_name_clusters(tools)
    similar = find_similar_pairs(tools)
    quick_wins = find_quick_wins(tools, clusters, budgets)

    # Assessment
    if len(tools) > 30 or total > 10000:
        severity = "critical"
    elif len(tools) > 20 or total > 5000:
        severity = "high"
    elif len(tools) > 10:
        severity = "moderate"
    else:
        severity = "good"

    assessment = f"{len(tools)} tools ({total:,} tokens menu cost) — "
    if severity == "critical":
        assessment += (
            "significantly over recommended limits. "
            "Most LLMs perform best with <20 tools and <5K menu tokens."
        )
    elif severity == "high":
        assessment += (
            "above recommended limits. "
            "Consider consolidation to reduce menu overhead."
        )
    elif severity == "moderate":
        assessment += "moderate tool count. Some optimization may help."
    else:
        assessment += "within recommended range."

    return InventoryAnalysis(
        tool_count=len(tools),
        total_budget_tokens=total,
        budget_assessment=assessment,
        tool_budgets=budgets,
        name_clusters=clusters,
        similar_pairs=similar,
        quick_wins=quick_wins,
    )


# ---------------------------------------------------------------------------
# Serialisation helper
# ---------------------------------------------------------------------------


def analysis_to_dict(analysis: InventoryAnalysis) -> dict:
    """Convert an *InventoryAnalysis* to a JSON-serialisable dict."""
    return {
        "tool_count": analysis.tool_count,
        "total_budget_tokens": analysis.total_budget_tokens,
        "budget_assessment": analysis.budget_assessment,
        "tool_budgets": [
            {
                "name": b.name,
                "description_tokens": b.description_tokens,
                "schema_tokens": b.schema_tokens,
                "total_tokens": b.total_tokens,
            }
            for b in analysis.tool_budgets
        ],
        "name_clusters": [
            {"prefix": c.prefix, "tools": c.tools}
            for c in analysis.name_clusters
        ],
        "similar_pairs": [
            {"tool_a": p.tool_a, "tool_b": p.tool_b, "distance": p.distance}
            for p in analysis.similar_pairs
        ],
        "quick_wins": [
            {
                "type": qw.type,
                "description": qw.description,
                "tools": qw.tools,
                "estimated_savings": qw.estimated_savings,
            }
            for qw in analysis.quick_wins
        ],
    }
