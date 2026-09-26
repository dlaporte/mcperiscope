"""Report generation for MCP Optimizer.

Produces three output types:
1. Optimization plan (Markdown) - actionable changes for real MCP code
2. Analysis report (Markdown) - detailed findings
3. Analysis report (HTML) - self-contained interactive web report
"""

from __future__ import annotations

import html
import json
from datetime import datetime, timezone
from typing import Any

from backend.mcp_optimizer.analyze import group_traces_by_prompt


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _rec_tools(rec: dict) -> list[str]:
    """Tools a rec applies to (behavior recs: source_tools; quick wins: tools)."""
    return rec.get("source_tools") or rec.get("tools") or []


def _rec_savings(rec: dict) -> int:
    """Estimated token savings (behavior recs vs quick wins use different keys)."""
    return rec.get("estimated_token_savings") or rec.get("estimated_savings") or 0


# (label, key, format) rows of the before/after comparison (session.comparison)
_COMPARISON_METRICS = [
    ("Tool Count", "tool_count", "number"),
    ("Menu Tokens", "menu_tokens", "number"),
    ("Avg Tokens/Prompt", "avg_tokens_per_prompt", "number"),
    ("Avg Calls/Prompt", "avg_calls_per_prompt", "decimal"),
    ("Total Context", "total_context", "number"),
    ("Avg Latency (ms)", "avg_latency", "number"),
    ("Accuracy", "accuracy", "percent"),
    ("Error Rate", "error_rate", "percent"),
]


def _comparison_accuracy(comparison: Any) -> float | None:
    """Proxy accuracy from a run's comparison: the share of compared answers
    the analyst judged equivalent to the baseline. The one accuracy figure
    reports show; None when there is no run or no answers were compared."""
    if not isinstance(comparison, dict):
        return None
    return (comparison.get("proxy") or {}).get("accuracy")


def _analyst_by_index(analyst_results: list[dict], prompts: list[str | None]) -> dict[int, dict]:
    """Map eval index -> analyst result (by "index", else by prompt text)."""
    by_index: dict[int, dict] = {}
    for r in analyst_results or []:
        idx = r.get("index")
        if idx is None and r.get("prompt") in prompts:
            idx = prompts.index(r["prompt"])
        if idx is not None:
            by_index[idx] = r
    return by_index


# Analyst verdict -> (label, badge css suffix)
_VERDICT_BADGES = {
    "equivalent": ("EQUIVALENT", "correct"),
    "partial": ("PARTIAL", "partial"),
    "different": ("DIFFERENT", "wrong"),
    "error": ("NOT COMPARED", "unrated"),
}


def _delta_value(delta: Any) -> Any:
    """session.comparison stores deltas as {"value", "pct"}; reports show the value."""
    return delta.get("value") if isinstance(delta, dict) else delta


# ---------------------------------------------------------------------------
# Optimization plan (Markdown)
# ---------------------------------------------------------------------------


def generate_plan_md(
    url: str,
    inventory: dict,
    recommendations: list[dict],
    traces: list[dict],
    prompts: list[str | None],
    filter_by_impact: bool = True,
) -> str:
    """Generate an optimisation plan as Markdown.

    `prompts` is positional by eval index; None marks a deleted eval.
    `recommendations` may mix behavior recs and quick wins. With
    `filter_by_impact`, only HIGH/MEDIUM recs are listed (all of them if none
    qualify); pass False when the caller already chose the recs.
    """
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    lines: list[str] = []

    lines.append("# MCP Optimization Plan")
    lines.append("")
    lines.append(f"**Target:** `{url}`  ")
    lines.append(f"**Generated:** {now}  ")
    lines.append("")

    # --- Baseline Metrics ---
    lines.append("## Baseline Metrics")
    lines.append("")
    tool_count = inventory.get("tool_count", 0)
    budget = inventory.get("total_budget_tokens", 0)
    lines.append(f"- **Tools:** {tool_count}")
    lines.append(f"- **Menu token cost:** {budget:,}")
    lines.append(f"- **Assessment:** {inventory.get('budget_assessment', 'N/A')}")

    # Per-prompt metrics cover eval traces only, not manual Explore-tab calls.
    trace_groups = group_traces_by_prompt(traces)
    prompt_traces = [t for group in trace_groups.values() for t in group]
    if prompt_traces:
        prompt_count = len(trace_groups)
        total_tokens = sum(t.get("tool_response_tokens_est", 0) for t in prompt_traces)
        total_calls = len(prompt_traces)
        error_calls = sum(1 for t in prompt_traces if t.get("error_category") is not None)
        lines.append(f"- **Avg calls/prompt:** {total_calls / prompt_count:.1f}" if prompt_count else "")
        lines.append(f"- **Avg response tokens/prompt:** {total_tokens / prompt_count:,.0f}" if prompt_count else "")
        lines.append(f"- **Error rate:** {error_calls / total_calls * 100:.1f}%" if total_calls else "")
    lines.append("")

    # --- Approved Optimisations ---
    approved = recommendations
    if filter_by_impact:
        approved = [r for r in recommendations if r.get("impact") in ("HIGH", "MEDIUM")] or recommendations

    lines.append("## Approved Optimizations")
    lines.append("")

    if not approved:
        lines.append("_No optimizations identified._")
    else:
        for i, rec in enumerate(approved, 1):
            lines.append(f"### {i}. {rec.get('description', 'Unnamed')}")
            lines.append("")
            lines.append(f"- **Type:** `{rec.get('type', '?')}`")
            if rec.get("impact"):
                lines.append(f"- **Impact:** {rec['impact']}")
            if rec.get("risk"):
                lines.append(f"- **Risk:** {rec['risk']}")
            if rec.get("plan_only"):
                lines.append("- **Plan only:** not applied by the generated proxy")

            source_tools = _rec_tools(rec)
            if source_tools:
                lines.append(f"- **Source tools:** {', '.join(f'`{t}`' for t in source_tools)}")

            target = rec.get("target_tool")
            if target:
                lines.append(f"- **Target tool:** `{target.get('name', '?')}`")
                if target.get("parameters"):
                    lines.append(f"  - Parameters: {json.dumps(target['parameters'], indent=2)}")
                if target.get("description"):
                    lines.append(f"  - Description: {target['description']}")

            savings = _rec_savings(rec)
            if savings:
                lines.append(f"- **Estimated savings:** ~{savings:,} tokens")

            evidence = rec.get("evidence", "")
            if evidence:
                lines.append(f"- **Evidence:** {evidence}")
            lines.append("")

    # --- Summary ---
    total_savings = sum(_rec_savings(r) for r in approved)
    lines.append("## Summary")
    lines.append("")
    lines.append("| Metric | Value |")
    lines.append("|--------|-------|")
    lines.append(f"| Optimizations | {len(approved)} |")
    lines.append(f"| Estimated token savings | {total_savings:,} |")
    lines.append(f"| Tools before | {tool_count} |")
    removed = sum(len(_rec_tools(r)) for r in approved if r.get("type") in ("remove", "remove_unused"))
    merged = sum(
        max(0, len(_rec_tools(r)) - 1)
        for r in approved
        if r.get("type") in ("consolidate", "consolidate_lookups")
    )
    new_count = max(0, tool_count - removed - merged)
    lines.append(f"| Tools after (est.) | {new_count} |")
    lines.append("")

    # --- Evaluation Prompts ---
    live_prompts = [p for p in prompts if p is not None]
    if live_prompts:
        lines.append("## Evaluation Prompts Used")
        lines.append("")
        for j, prompt in enumerate(live_prompts, 1):
            lines.append(f"{j}. {prompt}")
        lines.append("")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Analysis report (Markdown)
# ---------------------------------------------------------------------------


def generate_report_md(data: dict) -> str:
    """Generate a full analysis report as Markdown."""
    url = data.get("url", "unknown")
    inventory = data.get("inventory", {})
    analysis = data.get("analysis", {})
    recommendations = data.get("recommendations", [])
    prompts = data.get("prompts", [])
    traces = data.get("traces", [])
    comp = data.get("comparison")
    analyst = _analyst_by_index(data.get("analyst_results", []), prompts)

    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    lines: list[str] = []

    lines.append("# MCP Optimizer Analysis Report")
    lines.append("")
    lines.append(f"**Target:** `{url}`  ")
    lines.append(f"**Generated:** {now}")
    lines.append("")

    # ---- 1. Executive Summary ----
    lines.append("## 1. Executive Summary")
    lines.append("")

    tool_count = inventory.get("tool_count", 0)
    budget = inventory.get("total_budget_tokens", 0)
    total_savings = sum(_rec_savings(r) for r in recommendations)
    high_impact = [r for r in recommendations if r.get("impact") == "HIGH"]
    med_impact = [r for r in recommendations if r.get("impact") == "MEDIUM"]

    lines.append(f"- **{tool_count}** tools consuming **{budget:,}** menu tokens")
    lines.append(f"- **{len(recommendations)}** optimization recommendations "
                 f"({len(high_impact)} high, {len(med_impact)} medium impact)")
    lines.append(f"- **{total_savings:,}** estimated token savings")

    accuracy = _comparison_accuracy(comp)
    if accuracy is not None:
        lines.append(f"- **Accuracy:** {accuracy * 100:.0f}% of proxy answers equivalent to baseline")

    lines.append(f"- **Assessment:** {inventory.get('budget_assessment', 'N/A')}")
    lines.append("")

    # ---- 2. Tool Inventory ----
    lines.append("## 2. Tool Inventory")
    lines.append("")

    budgets = inventory.get("tool_budgets", [])
    if budgets:
        lines.append("| Tool | Desc Tokens | Schema Tokens | Total | Description Quality |")
        lines.append("|------|------------|---------------|-------|-------------------|")

        # Build description scores map
        desc_scores = {}
        static = analysis.get("static_analysis", {})
        for d in static.get("descriptions", []):
            desc_scores[d["name"]] = d.get("overall_score", "?")

        for b in budgets:
            name = b.get("name", b) if isinstance(b, dict) else b
            desc_tok = b.get("description_tokens", 0) if isinstance(b, dict) else 0
            schema_tok = b.get("schema_tokens", 0) if isinstance(b, dict) else 0
            total_tok = b.get("total_tokens", 0) if isinstance(b, dict) else 0
            quality = desc_scores.get(name, "N/A")
            lines.append(f"| `{name}` | {desc_tok} | {schema_tok} | {total_tok} | {quality}/10 |")
        lines.append("")
    else:
        lines.append("_No tool inventory data available._")
        lines.append("")

    # ---- 3. Optimization Recommendations ----
    lines.append("## 3. Optimization Recommendations")
    lines.append("")

    if not recommendations:
        lines.append("_No recommendations._")
    else:
        # Group by impact
        for impact_level in ("HIGH", "MEDIUM", "LOW"):
            group = [r for r in recommendations if r.get("impact") == impact_level]
            if not group:
                continue
            lines.append(f"### {impact_level} Impact")
            lines.append("")
            for rec in group:
                lines.append(f"**{rec.get('id', '?')}** — {rec.get('description', '')}")
                lines.append("")
                lines.append(f"- Type: `{rec.get('type', '?')}`")
                lines.append(f"- Risk: {rec.get('risk', '?')}")
                source_tools = _rec_tools(rec)
                if source_tools:
                    lines.append(f"- Source: {', '.join(f'`{t}`' for t in source_tools)}")
                savings = _rec_savings(rec)
                if savings:
                    lines.append(f"- Savings: ~{savings:,} tokens")
                evidence = rec.get("evidence", "")
                if evidence:
                    lines.append(f"- Evidence: {evidence}")
                lines.append("")

    # ---- 4. Evaluation Results ----
    lines.append("## 4. Evaluation Results")
    lines.append("")

    # Positional by eval index; trace groups and analyst results share it.
    trace_groups = group_traces_by_prompt(traces)
    live = [(i, p) for i, p in enumerate(prompts) if p is not None]
    if not live:
        lines.append("_No evaluation results available._")
    else:
        for i, prompt_text in live:
            result = analyst.get(i)
            label = _VERDICT_BADGES.get(result.get("verdict"), ("NOT COMPARED", ""))[0] if result else "NOT COMPARED"
            lines.append(f"### Prompt {i + 1}: {label}")
            lines.append("")
            lines.append(f"> {prompt_text}")
            lines.append("")
            calls = [t.get("tool_name", "?") for t in trace_groups.get(i, [])]
            lines.append(f"- **Tool calls:** {' → '.join(f'`{c}`' for c in calls) if calls else 'none'}")
            if result and result.get("explanation"):
                lines.append(f"- **Analyst:** {result['explanation']}")
            lines.append("")
    lines.append("")

    # ---- 5. Before/After Comparison ----
    if isinstance(comp, dict) and "baseline" in comp and "proxy" in comp:
        lines.append("## 5. Before / After Comparison")
        lines.append("")
        bl = comp["baseline"]
        px = comp["proxy"]
        dl = comp.get("delta", {})
        lines.append("| Metric | Baseline | Proxy | Delta |")
        lines.append("|--------|----------|-------|-------|")
        for label, key, fmt in _COMPARISON_METRICS:
            bv = _fmt_value(bl.get(key), fmt)
            pv = _fmt_value(px.get(key), fmt)
            dv = _delta_value(dl.get(key))
            if isinstance(dv, (int, float)) and fmt == "percent":
                dv = f"{dv:+.2%}"
            elif isinstance(dv, (int, float)):
                dv = f"{dv:+}" if dv != 0 else "0"
            else:
                dv = "N/A"
            lines.append(f"| {label} | {bv} | {pv} | {dv} |")
        lines.append("")

        warning = comp.get("accuracy_warning")
        if warning:
            lines.append(f"> **Warning:** {warning}")
            lines.append("")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Analysis report (HTML)
# ---------------------------------------------------------------------------


def generate_report_html(data: dict) -> str:
    """Generate a self-contained interactive HTML report."""
    url = data.get("url", "unknown")
    inventory = data.get("inventory", {})
    analysis = data.get("analysis", {})
    recommendations = data.get("recommendations", [])
    traces = data.get("traces", [])
    prompts = data.get("prompts", [])
    comparison = data.get("comparison")
    analyst = _analyst_by_index(data.get("analyst_results", []), prompts)
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    tool_count = inventory.get("tool_count", 0)
    budget = inventory.get("total_budget_tokens", 0)
    total_savings = sum(_rec_savings(r) for r in recommendations)

    accuracy = _comparison_accuracy(comparison)
    accuracy_pct = f"{accuracy * 100:.0f}%" if accuracy is not None else "N/A"

    # Build description score map
    static = analysis.get("static_analysis", {})
    desc_scores: dict[str, Any] = {}
    for d in static.get("descriptions", []):
        desc_scores[d["name"]] = d.get("overall_score", "?")

    # Generate the plan markdown for the copy-to-clipboard section
    plan_md = generate_plan_md(url, inventory, recommendations, traces, prompts)

    # --- Build HTML sections ---

    # Metric cards
    metric_cards_html = _html_metric_cards(
        tool_count, budget, accuracy_pct, total_savings, len(recommendations)
    )

    # Tool inventory table
    inventory_table_html = _html_inventory_table(inventory, desc_scores)

    # Recommendations
    recs_html = _html_recommendations(recommendations)

    # Evaluation results
    eval_html = _html_evaluation_results(prompts, traces, analyst)

    # Comparison section
    comparison_html = _html_comparison(comparison)

    # Plan section
    plan_html = f"""<pre id="plan-content">{html.escape(plan_md)}</pre>"""

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>MCP Optimizer Report</title>
    <style>{_CSS}</style>
</head>
<body>
    <header>
        <h1>MCP Optimizer Report</h1>
        <p class="subtitle">Target: <code>{html.escape(url)}</code> &nbsp;|&nbsp; Generated: {html.escape(now)}</p>
    </header>

    <section id="summary">
        <h2>Summary</h2>
        <div class="metric-cards">
            {metric_cards_html}
        </div>
    </section>

    <section id="inventory">
        <h2>Tool Inventory</h2>
        {inventory_table_html}
    </section>

    <section id="recommendations">
        <h2>Optimization Recommendations</h2>
        <div class="filter-bar">
            <button class="filter-btn active" data-filter="all">All</button>
            <button class="filter-btn" data-filter="HIGH">High</button>
            <button class="filter-btn" data-filter="MEDIUM">Medium</button>
            <button class="filter-btn" data-filter="LOW">Low</button>
        </div>
        <div class="rec-cards">
            {recs_html}
        </div>
    </section>

    <section id="evaluation">
        <h2>Evaluation Results</h2>
        {eval_html}
    </section>

    <section id="comparison">
        <h2>Before / After</h2>
        {comparison_html}
    </section>

    <section id="plan">
        <h2>Optimization Plan</h2>
        <button class="copy-btn" onclick="copyPlan()">Copy to clipboard</button>
        {plan_html}
    </section>

    <script>{_JS}</script>
</body>
</html>"""


# ---------------------------------------------------------------------------
# HTML builder helpers
# ---------------------------------------------------------------------------


def _html_metric_cards(
    tool_count: int,
    budget: int,
    accuracy_pct: str,
    total_savings: int,
    rec_count: int,
) -> str:
    cards = [
        ("Tools", str(tool_count), "Total tool count"),
        ("Menu Budget", f"{budget:,} tok", "Token cost of tool definitions"),
        ("Accuracy", accuracy_pct, "Proxy answers equivalent to baseline"),
        ("Savings", f"{total_savings:,} tok", "Estimated token savings"),
        ("Recommendations", str(rec_count), "Optimization actions"),
    ]
    parts = []
    for title, value, subtitle in cards:
        parts.append(
            f'<div class="metric-card">'
            f'<div class="metric-value">{html.escape(value)}</div>'
            f'<div class="metric-title">{html.escape(title)}</div>'
            f'<div class="metric-sub">{html.escape(subtitle)}</div>'
            f'</div>'
        )
    return "\n".join(parts)


def _html_inventory_table(inventory: dict, desc_scores: dict) -> str:
    budgets = inventory.get("tool_budgets", [])
    if not budgets:
        return "<p>No tool inventory data available.</p>"

    rows = []
    for b in budgets:
        if not isinstance(b, dict):
            continue
        name = b.get("name", "?")
        desc_tok = b.get("description_tokens", 0)
        schema_tok = b.get("schema_tokens", 0)
        total_tok = b.get("total_tokens", 0)
        quality = desc_scores.get(name, "N/A")
        quality_cls = ""
        if isinstance(quality, (int, float)):
            if quality >= 7:
                quality_cls = "good"
            elif quality >= 4:
                quality_cls = "ok"
            else:
                quality_cls = "poor"
        rows.append(
            f"<tr>"
            f"<td><code>{html.escape(name)}</code></td>"
            f"<td class='num'>{desc_tok}</td>"
            f"<td class='num'>{schema_tok}</td>"
            f"<td class='num'>{total_tok}</td>"
            f"<td class='num {quality_cls}'>{quality}/10</td>"
            f"</tr>"
        )

    return f"""<table class="sortable" id="inventory-table">
        <thead>
            <tr>
                <th data-sort="string">Tool</th>
                <th data-sort="number">Desc Tokens</th>
                <th data-sort="number">Schema Tokens</th>
                <th data-sort="number">Total Tokens</th>
                <th data-sort="number">Desc Quality</th>
            </tr>
        </thead>
        <tbody>
            {"".join(rows)}
        </tbody>
    </table>"""


def _html_recommendations(recommendations: list[dict]) -> str:
    if not recommendations:
        return "<p>No recommendations.</p>"

    parts = []
    for rec in recommendations:
        rec_id = rec.get("id", "?")
        rec_type = rec.get("type", "?")
        impact = rec.get("impact", "?")
        risk = rec.get("risk", "?")
        description = rec.get("description", "")
        evidence = rec.get("evidence", "")
        savings = _rec_savings(rec)
        source_tools = _rec_tools(rec)
        target = rec.get("target_tool")

        impact_cls = impact.lower() if impact in ("HIGH", "MEDIUM", "LOW") else ""

        source_html = ", ".join(f"<code>{html.escape(t)}</code>" for t in source_tools)
        target_html = ""
        if target:
            target_name = target.get("name", "?")
            target_desc = target.get("description", "")
            target_html = (
                f"<div class='detail-row'><span class='detail-label'>Target tool:</span> "
                f"<code>{html.escape(target_name)}</code></div>"
                f"<div class='detail-row'><span class='detail-label'>Description:</span> "
                f"{html.escape(target_desc)}</div>"
            )

        parts.append(
            f'<div class="rec-card" data-impact="{html.escape(impact)}">'
            f'<div class="rec-header" onclick="toggleRec(this)">'
            f'<span class="rec-id">{html.escape(rec_id)}</span>'
            f'<span class="badge impact-{impact_cls}">{html.escape(impact)}</span>'
            f'<span class="badge type-badge">{html.escape(rec_type)}</span>'
            f'<span class="rec-title">{html.escape(description)}</span>'
            f'<span class="rec-chevron">&#9656;</span>'
            f'</div>'
            f'<div class="rec-details hidden">'
            f'<div class="detail-row"><span class="detail-label">Risk:</span> {html.escape(risk)}</div>'
            f'<div class="detail-row"><span class="detail-label">Source tools:</span> {source_html}</div>'
            f'{target_html}'
            f'<div class="detail-row"><span class="detail-label">Savings:</span> ~{savings:,} tokens</div>'
            f'<div class="detail-row"><span class="detail-label">Evidence:</span> {html.escape(evidence)}</div>'
            f'</div>'
            f'</div>'
        )

    return "\n".join(parts)


def _html_evaluation_results(
    prompts: list[str | None], traces: list[dict], analyst: dict[int, dict]
) -> str:
    """One card per live eval: prompt, tool call timeline, analyst verdict."""
    live = [(i, p) for i, p in enumerate(prompts) if p is not None]
    if not live:
        return "<p>No evaluation results available.</p>"

    # Group traces by prompt
    trace_groups = group_traces_by_prompt(traces)

    parts = []
    for i, prompt_text in live:
        result = analyst.get(i) or {}
        label, badge_cls = _VERDICT_BADGES.get(result.get("verdict"), ("NOT COMPARED", "unrated"))
        notes = result.get("explanation", "")

        # Build tool call timeline (prompts and trace groups share the eval index)
        timeline_html = ""
        group = trace_groups.get(i)
        if group:
            steps = []
            for t in group:
                t_name = t.get("tool_name", "?")
                has_error = t.get("error_category") is not None
                step_cls = "step-error" if has_error else "step-ok"
                steps.append(
                    f'<span class="timeline-step {step_cls}" '
                    f'title="{html.escape(t_name)}">{html.escape(t_name)}</span>'
                )
            if steps:
                timeline_html = (
                    f'<div class="timeline">'
                    f'{"".join(steps)}'
                    f'</div>'
                )

        parts.append(
            f'<div class="eval-card">'
            f'<div class="eval-header">'
            f'<span class="badge correctness-{badge_cls}">{html.escape(label)}</span>'
            f'<span class="eval-prompt">Prompt {i + 1}: {html.escape(prompt_text)}</span>'
            f'</div>'
            f'{timeline_html}'
            f'<div class="eval-explanation">{html.escape(notes)}</div>'
            f'</div>'
        )

    return "\n".join(parts)


def _html_comparison(comparison: Any) -> str:
    if not comparison or not isinstance(comparison, dict):
        return "<p>No comparison data yet. Run an optimization to generate it.</p>"

    bl = comparison.get("baseline", {})
    px = comparison.get("proxy", {})
    dl = comparison.get("delta", {})
    warning = comparison.get("accuracy_warning")

    rows = []
    for label, key, fmt in _COMPARISON_METRICS:
        bv = bl.get(key)
        pv = px.get(key)
        dv = _delta_value(dl.get(key))

        bv_str = _fmt_value(bv, fmt)
        pv_str = _fmt_value(pv, fmt)

        if dv is not None and isinstance(dv, (int, float)):
            # For most metrics, negative delta = improvement; for accuracy, positive = improvement
            if key == "accuracy":
                delta_cls = "delta-good" if dv >= 0 else "delta-bad"
            else:
                delta_cls = "delta-good" if dv <= 0 else "delta-bad"
            if fmt == "percent" and isinstance(dv, float):
                dv_str = f"{dv:+.2%}"
            elif fmt == "decimal":
                dv_str = f"{dv:+.2f}"
            else:
                dv_str = f"{dv:+}"
        else:
            delta_cls = ""
            dv_str = "N/A"

        rows.append(
            f"<tr>"
            f"<td>{html.escape(label)}</td>"
            f"<td class='num'>{bv_str}</td>"
            f"<td class='num'>{pv_str}</td>"
            f"<td class='num {delta_cls}'>{dv_str}</td>"
            f"</tr>"
        )

    warning_html = ""
    if warning:
        warning_html = f'<div class="warning">{html.escape(warning)}</div>'

    return f"""{warning_html}
    <table class="comparison-table">
        <thead>
            <tr>
                <th>Metric</th>
                <th>Baseline</th>
                <th>Proxy</th>
                <th>Delta</th>
            </tr>
        </thead>
        <tbody>
            {"".join(rows)}
        </tbody>
    </table>"""


def _fmt_value(v: Any, fmt: str) -> str:
    if v is None:
        return "N/A"
    if fmt == "percent" and isinstance(v, (int, float)):
        return f"{v:.2%}"
    if fmt == "decimal" and isinstance(v, (int, float)):
        return f"{v:.2f}"
    if fmt == "number" and isinstance(v, (int, float)):
        return f"{v:,}"
    return str(v)


# ---------------------------------------------------------------------------
# Inlined CSS
# ---------------------------------------------------------------------------

_CSS = """
:root {
    --bg: #0f1117;
    --bg-card: #1a1d27;
    --bg-hover: #22263a;
    --border: #2a2e3e;
    --text: #e1e4ed;
    --text-muted: #8b8fa3;
    --accent: #6c7ee1;
    --accent-hover: #8b9bf0;
    --green: #3ecf8e;
    --green-bg: rgba(62, 207, 142, 0.12);
    --yellow: #f0b429;
    --yellow-bg: rgba(240, 180, 41, 0.12);
    --red: #ef6461;
    --red-bg: rgba(239, 100, 97, 0.12);
    --orange: #f59e0b;
    --orange-bg: rgba(245, 158, 11, 0.12);
    --font-mono: 'SF Mono', 'Cascadia Code', 'Fira Code', monospace;
    --font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    --radius: 8px;
}

* { margin: 0; padding: 0; box-sizing: border-box; }

body {
    font-family: var(--font-sans);
    background: var(--bg);
    color: var(--text);
    line-height: 1.6;
    padding: 0;
}

header {
    background: var(--bg-card);
    border-bottom: 1px solid var(--border);
    padding: 2rem 2rem 1.5rem;
}

header h1 {
    font-size: 1.75rem;
    font-weight: 700;
    margin-bottom: 0.25rem;
}

.subtitle {
    color: var(--text-muted);
    font-size: 0.9rem;
}

.subtitle code {
    background: var(--bg);
    padding: 2px 6px;
    border-radius: 4px;
    font-family: var(--font-mono);
    font-size: 0.85rem;
}

section {
    max-width: 1200px;
    margin: 0 auto;
    padding: 2rem;
}

section h2 {
    font-size: 1.35rem;
    font-weight: 600;
    margin-bottom: 1.25rem;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid var(--border);
}

/* Metric Cards */
.metric-cards {
    display: flex;
    gap: 1rem;
    flex-wrap: wrap;
}

.metric-card {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 1.25rem 1.5rem;
    flex: 1;
    min-width: 160px;
    text-align: center;
}

.metric-value {
    font-size: 1.75rem;
    font-weight: 700;
    color: var(--accent);
}

.metric-title {
    font-size: 0.85rem;
    font-weight: 600;
    margin-top: 0.25rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
}

.metric-sub {
    font-size: 0.75rem;
    color: var(--text-muted);
    margin-top: 0.15rem;
}

/* Tables */
table {
    width: 100%;
    border-collapse: collapse;
    background: var(--bg-card);
    border-radius: var(--radius);
    overflow: hidden;
    border: 1px solid var(--border);
}

thead {
    background: rgba(108, 126, 225, 0.08);
}

th {
    text-align: left;
    padding: 0.75rem 1rem;
    font-size: 0.8rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
    cursor: pointer;
    user-select: none;
    white-space: nowrap;
}

th:hover {
    color: var(--accent);
}

th.sort-asc::after { content: ' \\25B2'; font-size: 0.65rem; }
th.sort-desc::after { content: ' \\25BC'; font-size: 0.65rem; }

td {
    padding: 0.6rem 1rem;
    border-top: 1px solid var(--border);
    font-size: 0.9rem;
}

td.num {
    text-align: right;
    font-family: var(--font-mono);
    font-size: 0.85rem;
}

td.good { color: var(--green); }
td.ok { color: var(--yellow); }
td.poor { color: var(--red); }

tr:hover { background: var(--bg-hover); }

td code, .rec-details code {
    background: var(--bg);
    padding: 1px 5px;
    border-radius: 3px;
    font-family: var(--font-mono);
    font-size: 0.83rem;
}

/* Badges */
.badge {
    display: inline-block;
    padding: 2px 10px;
    border-radius: 12px;
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
}

.impact-high { background: var(--red-bg); color: var(--red); }
.impact-medium { background: var(--orange-bg); color: var(--orange); }
.impact-low { background: var(--green-bg); color: var(--green); }
.type-badge { background: rgba(108, 126, 225, 0.12); color: var(--accent); }

.correctness-correct { background: var(--green-bg); color: var(--green); }
.correctness-partial { background: var(--yellow-bg); color: var(--yellow); }
.correctness-wrong { background: var(--red-bg); color: var(--red); }
.correctness-unrated { background: rgba(139, 143, 163, 0.12); color: var(--text-muted); }

/* Filter bar */
.filter-bar {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 1rem;
}

.filter-btn {
    background: var(--bg-card);
    color: var(--text-muted);
    border: 1px solid var(--border);
    padding: 0.4rem 1rem;
    border-radius: 20px;
    cursor: pointer;
    font-size: 0.8rem;
    font-weight: 600;
    transition: all 0.15s;
}

.filter-btn:hover { border-color: var(--accent); color: var(--text); }
.filter-btn.active { background: var(--accent); color: #fff; border-color: var(--accent); }

/* Recommendation cards */
.rec-card {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    margin-bottom: 0.75rem;
    overflow: hidden;
}

.rec-header {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.85rem 1rem;
    cursor: pointer;
    transition: background 0.15s;
}

.rec-header:hover { background: var(--bg-hover); }

.rec-id {
    font-family: var(--font-mono);
    font-size: 0.75rem;
    color: var(--text-muted);
    min-width: 52px;
}

.rec-title {
    flex: 1;
    font-size: 0.9rem;
}

.rec-chevron {
    color: var(--text-muted);
    font-size: 0.9rem;
    transition: transform 0.2s;
}

.rec-card.expanded .rec-chevron {
    transform: rotate(90deg);
}

.rec-details {
    padding: 0 1rem 1rem;
    border-top: 1px solid var(--border);
}

.rec-details.hidden {
    display: none;
}

.detail-row {
    padding: 0.35rem 0;
    font-size: 0.88rem;
}

.detail-label {
    font-weight: 600;
    color: var(--text-muted);
    margin-right: 0.4rem;
}

/* Evaluation cards */
.eval-card {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 1rem 1.25rem;
    margin-bottom: 0.75rem;
}

.eval-header {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 0.5rem;
}

.eval-prompt {
    font-size: 0.9rem;
}

.eval-explanation {
    color: var(--text-muted);
    font-size: 0.85rem;
    margin-top: 0.4rem;
}

.tool-chain {
    font-size: 0.85rem;
    margin-bottom: 0.4rem;
}

/* Timeline */
.timeline {
    display: flex;
    gap: 4px;
    align-items: center;
    margin: 0.5rem 0;
    flex-wrap: wrap;
}

.timeline-step {
    display: inline-block;
    background: rgba(108, 126, 225, 0.15);
    color: var(--accent);
    padding: 3px 10px;
    border-radius: 4px;
    font-family: var(--font-mono);
    font-size: 0.75rem;
    position: relative;
}

.timeline-step:not(:last-child)::after {
    content: '\\2192';
    position: absolute;
    right: -12px;
    color: var(--text-muted);
    font-size: 0.7rem;
}

.timeline-step:not(:last-child) {
    margin-right: 12px;
}

.timeline-step.step-error {
    background: var(--red-bg);
    color: var(--red);
}

.timeline-step.step-ok {
    background: rgba(108, 126, 225, 0.15);
    color: var(--accent);
}

/* Comparison */
.comparison-table .delta-good { color: var(--green); font-weight: 600; }
.comparison-table .delta-bad { color: var(--red); font-weight: 600; }

.warning {
    background: var(--red-bg);
    border: 1px solid rgba(239, 100, 97, 0.3);
    border-radius: var(--radius);
    padding: 0.75rem 1rem;
    margin-bottom: 1rem;
    color: var(--red);
    font-size: 0.9rem;
}

/* Plan section */
#plan pre {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 1.25rem;
    font-family: var(--font-mono);
    font-size: 0.8rem;
    line-height: 1.5;
    overflow-x: auto;
    white-space: pre-wrap;
    word-wrap: break-word;
    color: var(--text);
    max-height: 600px;
    overflow-y: auto;
}

.copy-btn {
    background: var(--accent);
    color: #fff;
    border: none;
    padding: 0.5rem 1.25rem;
    border-radius: var(--radius);
    cursor: pointer;
    font-size: 0.85rem;
    font-weight: 600;
    margin-bottom: 0.75rem;
    transition: background 0.15s;
}

.copy-btn:hover { background: var(--accent-hover); }
.copy-btn.copied { background: var(--green); }

/* Responsive */
@media (max-width: 768px) {
    .metric-cards { flex-direction: column; }
    section { padding: 1.25rem; }
    header { padding: 1.25rem; }
    .rec-header { flex-wrap: wrap; }
    .timeline { gap: 2px; }
}
"""

# ---------------------------------------------------------------------------
# Inlined JavaScript
# ---------------------------------------------------------------------------

_JS = """
// --- Table Sorting ---
document.querySelectorAll('table.sortable').forEach(function(table) {
    var headers = table.querySelectorAll('th');
    headers.forEach(function(th, colIndex) {
        th.addEventListener('click', function() {
            var sortType = th.getAttribute('data-sort') || 'string';
            var tbody = table.querySelector('tbody');
            var rows = Array.from(tbody.querySelectorAll('tr'));
            var ascending = !th.classList.contains('sort-asc');

            // Clear other sort indicators
            headers.forEach(function(h) { h.classList.remove('sort-asc', 'sort-desc'); });
            th.classList.add(ascending ? 'sort-asc' : 'sort-desc');

            rows.sort(function(a, b) {
                var aText = a.cells[colIndex].textContent.trim();
                var bText = b.cells[colIndex].textContent.trim();
                var aVal, bVal;

                if (sortType === 'number') {
                    aVal = parseFloat(aText.replace(/[^0-9.\\-]/g, '')) || 0;
                    bVal = parseFloat(bText.replace(/[^0-9.\\-]/g, '')) || 0;
                } else {
                    aVal = aText.toLowerCase();
                    bVal = bText.toLowerCase();
                }

                if (aVal < bVal) return ascending ? -1 : 1;
                if (aVal > bVal) return ascending ? 1 : -1;
                return 0;
            });

            rows.forEach(function(row) { tbody.appendChild(row); });
        });
    });
});

// --- Recommendation expand/collapse ---
function toggleRec(headerEl) {
    var card = headerEl.closest('.rec-card');
    var details = card.querySelector('.rec-details');
    if (details.classList.contains('hidden')) {
        details.classList.remove('hidden');
        card.classList.add('expanded');
    } else {
        details.classList.add('hidden');
        card.classList.remove('expanded');
    }
}

// --- Filter bar ---
document.querySelectorAll('.filter-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
        document.querySelectorAll('.filter-btn').forEach(function(b) {
            b.classList.remove('active');
        });
        btn.classList.add('active');

        var filter = btn.getAttribute('data-filter');
        document.querySelectorAll('.rec-card').forEach(function(card) {
            if (filter === 'all' || card.getAttribute('data-impact') === filter) {
                card.style.display = '';
            } else {
                card.style.display = 'none';
            }
        });
    });
});

// --- Copy plan to clipboard ---
function copyPlan() {
    var planEl = document.getElementById('plan-content');
    var text = planEl.textContent;
    navigator.clipboard.writeText(text).then(function() {
        var btn = document.querySelector('.copy-btn');
        var orig = btn.textContent;
        btn.textContent = 'Copied!';
        btn.classList.add('copied');
        setTimeout(function() {
            btn.textContent = orig;
            btn.classList.remove('copied');
        }, 2000);
    }).catch(function() {
        // Fallback for older browsers
        var textarea = document.createElement('textarea');
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        var btn = document.querySelector('.copy-btn');
        var orig = btn.textContent;
        btn.textContent = 'Copied!';
        btn.classList.add('copied');
        setTimeout(function() {
            btn.textContent = orig;
            btn.classList.remove('copied');
        }, 2000);
    });
}
"""
