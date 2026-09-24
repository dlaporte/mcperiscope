"""Analyze an MCP server's tool inventory immediately after connection.

Takes a list of mcp.types.Tool objects and produces a structured analysis
of token budgets, plus name-clustering and Levenshtein helpers used by the
analysis routes.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass

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
class InventoryAnalysis:
    tool_count: int
    total_budget_tokens: int
    budget_assessment: str
    tool_budgets: list[ToolBudgetEntry]  # sorted by total_tokens desc


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
# Main analysis entry point
# ---------------------------------------------------------------------------


def analyze_inventory(tools: list[Tool]) -> InventoryAnalysis:
    """Run full inventory analysis on a list of tools."""
    budgets = [tool_token_budget(t) for t in tools]
    budgets.sort(key=lambda b: b.total_tokens, reverse=True)
    total = sum(b.total_tokens for b in budgets)

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
    }
