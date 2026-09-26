"""Per-prompt trace grouping, comparison populations, plan and report inputs."""

from __future__ import annotations

from backend.mcp_optimizer.analyze import (
    find_redundant_calls,
    find_sequence_patterns,
    group_traces_by_prompt,
)
from backend.mcp_optimizer.report import generate_plan_md, generate_report_html, generate_report_md
from backend.proxy_builder import mark_plan_only
from backend.routes.optimize import _baseline_population


def _t(tool: str, prompt_index: int | None, step: int = 1, **extra) -> dict:
    return {"tool_name": tool, "prompt_index": prompt_index, "step": step,
            "tool_input": {}, "tool_response_tokens_est": 10, **extra}


def test_group_traces_by_prompt_uses_prompt_index():
    traces = [
        _t("a", 1), _t("manual", None), _t("b", 0), _t("c", 1, step=2),
        {"tool_name": "legacy", "step": 0},  # no prompt_index at all
    ]
    groups = group_traces_by_prompt(traces)
    assert list(groups) == [0, 1]  # ascending eval index, manual/legacy excluded
    assert [t["tool_name"] for t in groups[0]] == ["b"]
    assert [t["tool_name"] for t in groups[1]] == ["a", "c"]  # call order kept


def test_patterns_do_not_cross_prompt_boundaries():
    # Prompt 0 ends with a, prompt 1 starts with b: "a -> b" must not be a sequence.
    traces = [_t("x", 0), _t("a", 0, step=2), _t("b", 1), _t("y", 1, step=2)]
    patterns = [p["pattern"] for p in find_sequence_patterns(traces)]
    assert ["a", "b"] not in patterns
    assert all(p["total_groups"] == 2 for p in find_sequence_patterns(traces))


def test_redundant_calls_are_per_prompt_and_ignore_manual_calls():
    traces = [_t("a", 0), _t("a", 1), _t("a", None)]
    assert find_redundant_calls(traces) == []
    assert find_redundant_calls([_t("a", 0), _t("a", 0, step=2)])[0]["total_redundant_calls"] == 1


def test_baseline_population_is_included_evals_only():
    evals = [
        {"traceEvents": [_t("a", 0), _t("b", 0, step=2)]},
        {"traceEvents": [_t("c", 1)]},
        {"traceEvents": [_t("d", 2)]},
    ]
    traces, num_prompts = _baseline_population(evals, {0, 2})
    assert [t["tool_name"] for t in traces] == ["a", "b", "d"]
    assert num_prompts == 2
    assert _baseline_population(evals, set()) == ([], 1)


def test_mark_plan_only():
    recs = mark_plan_only([{"type": "consolidate"}, {"type": "trim_response"}, {"type": "batch"},
                           {"type": "add_defaults"}, {"type": "remove_unused"}])
    assert [r["plan_only"] for r in recs] == [False, True, True, True, False]


def test_run_plan_includes_quick_wins_and_low_recs():
    recs = [
        {"type": "consolidate", "impact": "LOW", "description": "low rec",
         "source_tools": ["a_x", "a_y"], "estimated_token_savings": 50},
        {"type": "remove_unused", "description": "unused qw", "tools": ["z1", "z2"],
         "estimated_savings": 100},
    ]
    inventory = {"tool_count": 10}
    md = generate_plan_md("u", inventory, recs, [], [], filter_by_impact=False)
    assert "low rec" in md and "unused qw" in md
    assert "`z1`" in md and "~100 tokens" in md
    assert "| Estimated token savings | 150 |" in md
    assert "| Tools after (est.) | 7 |" in md  # 10 - 2 removed - 1 merged
    assert "Impact:** ?" not in md


def test_plan_metrics_ignore_manual_calls():
    traces = [_t("a", 0), _t("b", 1), _t("manual", None, error_category="boom")]
    md = generate_plan_md("u", {}, [], traces, [])
    assert "**Avg calls/prompt:** 1.0" in md
    assert "**Error rate:** 0.0%" in md


def _comparison() -> dict:
    return {
        "baseline": {"tool_count": 10, "menu_tokens": 1000, "total_context": 5000,
                     "avg_latency": 120.0, "accuracy": 1.0, "error_rate": 0.1},
        "proxy": {"tool_count": 6, "menu_tokens": 600, "total_context": 4000,
                  "avg_latency": 100.0, "accuracy": 0.5, "error_rate": 0.0},
        "delta": {"tool_count": {"value": -4, "pct": -40.0},
                  "accuracy": {"value": -0.5, "pct": -50.0}},
    }


def _report_data(**overrides) -> dict:
    data = {
        "url": "u", "inventory": {}, "analysis": {}, "recommendations": [],
        "traces": [_t("search", 0)], "prompts": ["p"], "comparison": _comparison(),
        "analyst_results": [{"index": 0, "prompt": "p", "verdict": "different", "explanation": "missed a field"}],
    }
    data.update(overrides)
    return data


def test_report_md_comparison_and_notes():
    md = generate_report_md(_report_data())
    assert "## 5. Before / After Comparison" in md
    assert "| Tool Count | 10 | 6 | -4 |" in md
    assert "| Accuracy | 100.00% | 50.00% | -50.00% |" in md
    assert "| Total Context | 5,000 | 4,000 | N/A |" in md
    assert "### Prompt 1: DIFFERENT" in md
    assert "**Tool calls:** `search`" in md
    assert "**Analyst:** missed a field" in md
    assert "**Accuracy:** 50% of proxy answers" in md


def test_report_html_comparison_timeline_and_notes():
    out = generate_report_html(_report_data())
    assert "comparison-table" in out and "--baseline" not in out
    assert "missed a field" in out and "DIFFERENT" in out
    assert ">50%<" in out  # Accuracy card from the comparison
    assert 'title="search"' in out  # timeline for prompt 1 from its prompt_index group


def test_report_html_without_comparison():
    out = generate_report_html(_report_data(comparison=None, analyst_results=[]))
    assert "No comparison data yet" in out
    assert ">N/A<" in out  # Accuracy card without a run
    assert "NOT COMPARED" in out and 'title="search"' in out


def test_report_skips_deleted_evals():
    md = generate_report_md(_report_data(prompts=[None, "kept"], traces=[_t("gone", 0), _t("kept_tool", 1)]))
    assert "gone" not in md and "### Prompt 2" in md and "`kept_tool`" in md
