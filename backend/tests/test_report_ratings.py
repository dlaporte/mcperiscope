"""Report generation with the None-padded session.ratings list."""

from __future__ import annotations

from backend.mcp_optimizer.report import generate_plan_md, generate_report_html, generate_report_md

# /optimize/rate pads session.ratings with None up to the rated index.
_RATINGS = [
    None,
    {"prompt_index": 1, "prompt": "p1", "correctness": "correct", "notes": ""},
    None,
]
_PROMPTS = ["p0", "p1", "p2"]


def _data() -> dict:
    return {
        "url": "https://x/mcp",
        "inventory": {"tool_count": 1, "total_budget_tokens": 10},
        "analysis": {},
        "recommendations": [],
        "ratings": _RATINGS,
        "traces": [],
        "prompts": _PROMPTS,
        "baseline_results": [],
    }


def test_plan_md_with_none_ratings():
    md = generate_plan_md("https://x/mcp", {}, {}, [], _RATINGS, [], _PROMPTS)
    assert "1/1" in md


def test_report_md_with_none_ratings():
    md = generate_report_md(_data())
    # Only the rated eval is listed, under its own prompt.
    assert "### Prompt 2: PASS" in md
    assert "### Prompt 1" not in md


def test_report_html_with_none_ratings():
    out = generate_report_html(_data())
    assert "REPORT_DATA" not in out


def test_report_html_all_unrated():
    data = _data()
    data["ratings"] = [None, None]
    assert "No evaluation results available" in generate_report_html(data)
