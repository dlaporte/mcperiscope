"""Tests for pure helpers in routes/optimize.py."""

from __future__ import annotations

import anthropic
import httpx
import openai

from backend.routes.optimize import (
    _analyst_pairs,
    _failed_answer_reason,
    _llm_error_message,
    _proxy_resource_preamble,
)


def test_analyst_pairs_use_original_eval_index():
    evals = [{"answer": "a0"}, {"answer": "a1"}, {"answer": "a2"}]
    # Only evals 0 and 2 were included in the proxy re-run.
    proxy_answers = [
        {"index": 0, "prompt": "p0", "answer": "x0"},
        {"index": 2, "prompt": "p2", "answer": "x2"},
    ]
    assert _analyst_pairs(proxy_answers, evals) == [
        ("p0", evals[0], proxy_answers[0]),
        ("p2", evals[2], proxy_answers[1]),
    ]


def test_failed_answers_are_skipped_not_judged():
    ok = {"answer": "fine", "error": False, "stopped": False}
    assert _failed_answer_reason(ok, ok) is None
    # A baseline LLM error or round-limit stop is skipped, whatever its text says.
    assert "Baseline" in _failed_answer_reason({"answer": "Error: Rate limit", "error": True}, ok)
    assert "Baseline" in _failed_answer_reason({"answer": "[Stopped after 20 ...]", "stopped": True}, ok)
    assert "Proxy" in _failed_answer_reason(ok, {"answer": "Error: boom", "error": True})
    assert "Proxy" in _failed_answer_reason(ok, {"answer": ""})
    # An answer that merely starts with "Error:" is still compared.
    assert _failed_answer_reason(ok, {"answer": "Error: codes are listed below"}) is None


def test_proxy_resource_preamble_uses_condensed_text():
    loaded = {
        "r://a": {"name": "A", "content": "full A", "tokens": 100},
        "r://b": {"name": "B", "content": "full B", "tokens": 50},
        "r://c": {"name": "C", "content": "full C", "tokens": 10},
    }
    condensed = {"r://a": {"condensed": "short A", "condensed_tokens": 20}}
    msgs = _proxy_resource_preamble(loaded, condensed, {"r://c"})
    text = msgs[0]["content"]
    assert "short A" in text and "full A" not in text
    assert "full B" in text
    assert "full C" not in text


def test_analyst_pairs_skip_out_of_range():
    assert _analyst_pairs([{"index": 5, "prompt": "p", "answer": "x"}], [{"answer": "a"}]) == []


def _status_error(cls, status: int):
    req = httpx.Request("POST", "https://api.example.com")
    return cls("boom", response=httpx.Response(status, request=req), body=None)


def test_llm_error_message_by_type():
    req = httpx.Request("POST", "https://api.example.com")
    assert "Rate limit" in _llm_error_message(_status_error(anthropic.RateLimitError, 429))
    assert "Rate limit" in _llm_error_message(_status_error(openai.RateLimitError, 429))
    assert "Authentication" in _llm_error_message(_status_error(anthropic.AuthenticationError, 401))
    assert "Bad Gateway" in _llm_error_message(_status_error(anthropic.InternalServerError, 502))
    assert "timed out" in _llm_error_message(anthropic.APITimeoutError(request=req))
    assert "connect" in _llm_error_message(openai.APIConnectionError(request=req))


def test_llm_error_message_no_substring_matching():
    # "generate" contains "rate"; must not be reported as a rate limit.
    msg = _llm_error_message(ValueError("failed to generate response"))
    assert msg == "Error: failed to generate response"


def _set_creds(**fields):
    """Primary key bound to anthropic, analyst inheriting; `fields` override.

    Needs the clean_session fixture, which restores the session afterwards.
    """
    from backend.credentials import clear_analyst_credentials
    from backend.state import session

    clear_analyst_credentials(session)
    defaults = {
        "model": "m", "provider": "anthropic", "custom_endpoint": "",
        "api_key": "primary", "api_key_provider": "anthropic", "api_key_endpoint": "",
    }
    for k, v in {**defaults, **fields}.items():
        setattr(session, k, v)


def test_analyst_llm_reuses_primary_key_for_same_destination(monkeypatch, clean_session):
    from backend.routes import optimize

    seen = []
    monkeypatch.setattr(optimize, "LLMClient", lambda *a: seen.append(a) or object())
    _set_creds(analyst_model="analyst-m")
    assert optimize._analyst_llm() is not None
    assert seen == [("primary", "analyst-m", "anthropic", "")]


def test_analyst_llm_never_sends_primary_key_elsewhere(monkeypatch, clean_session):
    from backend.routes import optimize

    monkeypatch.setattr(optimize, "LLMClient", lambda *a: object())
    _set_creds(analyst_provider="custom", analyst_endpoint="https://evil.example/v1")
    assert optimize._analyst_llm() is None
    _set_creds(analyst_provider="openai")
    assert optimize._analyst_llm() is None


def test_analyst_llm_uses_analyst_key(monkeypatch, clean_session):
    from backend.routes import optimize

    seen = []
    monkeypatch.setattr(optimize, "LLMClient", lambda *a: seen.append(a) or object())
    _set_creds(analyst_api_key="ak", analyst_provider="custom",
               analyst_endpoint="https://llm.example/v1",
               analyst_api_key_provider="custom", analyst_api_key_endpoint="https://llm.example/v1")
    assert optimize._analyst_llm() is not None
    assert seen == [("ak", "m", "custom", "https://llm.example/v1")]


def test_inherited_analyst_key_not_sent_to_repointed_primary(monkeypatch, clean_session):
    """An analyst key bound under "inherit" stays with the destination it was bound to."""
    from backend.credentials import bind_analyst_credentials
    from backend.routes import optimize
    from backend.state import session

    seen = []
    monkeypatch.setattr(optimize, "LLMClient", lambda *a: seen.append(a) or object())
    _set_creds()
    bind_analyst_credentials(session, api_key="ak", provider="", endpoint="", model=None)
    assert (session.analyst_api_key_provider, session.analyst_api_key_endpoint) == ("anthropic", "")
    assert optimize._analyst_llm() is not None
    assert seen[-1][0] == "ak"

    # The caller re-points the primary LLM at their own endpoint.
    setattr(session, "provider", "custom")
    setattr(session, "custom_endpoint", "https://evil.example/v1")
    setattr(session, "api_key", "")
    seen.clear()
    assert optimize._analyst_llm() is None
    assert seen == []


def test_explicit_analyst_provider_does_not_inherit_primary_endpoint(clean_session):
    from backend.credentials import analyst_destination
    from backend.state import session

    _set_creds(provider="custom", custom_endpoint="https://llm.example/v1")
    assert analyst_destination(session) == ("custom", "https://llm.example/v1")
    setattr(session, "analyst_provider", "openai")
    assert analyst_destination(session) == ("openai", "")


def test_total_context_same_definition_both_sides(clean_session):
    from types import SimpleNamespace

    from backend.routes._common import _baseline_figures, _menu_tokens, _resource_tokens, _total_context
    from backend.state import session

    tool = SimpleNamespace(name="t", description="d" * 40, inputSchema={"type": "object", "properties": {}})
    trace = {"tool_response_tokens_est": 30, "tool_duration_s": 0.5, "error_category": None}
    setattr(session, "tools", [tool])
    setattr(session, "loaded_resources", {"r://a": {"tokens": 100}, "r://b": {"tokens": 40}})
    setattr(session, "eval_results", [
        {"traceEvents": [trace, trace], "usage": {"peak_context_tokens": 99_999}},
        {"traceEvents": [trace]},
        {"traceEvents": [trace] * 5},  # not included
    ])
    b = _baseline_figures({0, 1}, listing_tokens=7)
    menu = _menu_tokens([tool]) + 7
    assert b["menu_tokens"] == menu
    assert b["avg_tokens_per_prompt"] == 45.0
    # API peak context is ignored; resources count at their original size.
    assert b["total_context"] == menu + 140 + 45.0
    # Proxy side: condensed resources count condensed, disabled ones not at all.
    assert _resource_tokens(session.loaded_resources, {"r://a": {"condensed_tokens": 25}}, {"r://b"}) == 25
    assert _total_context(10, 25, 5.5) == 40.5


def test_manual_calls_excluded_from_error_cost_and_usage(clean_session):
    from types import SimpleNamespace

    from backend.mcp_optimizer.analyze import compute_error_cost
    from backend.routes.analysis import generate_quick_wins
    from backend.state import session

    traces = [
        {"tool_name": "a", "prompt_index": 0, "error_category": None},
        {"tool_name": "b", "prompt_index": None, "error_category": "boom", "tool_response_tokens_est": 9},
    ]
    assert compute_error_cost(traces)["total_error_calls"] == 0

    tools = [SimpleNamespace(name=n, description="d", inputSchema={"type": "object", "properties": {"x": {}}})
             for n in ("a", "b", "c")]
    setattr(session, "traces", traces)
    wins = generate_quick_wins(tools, "claude-sonnet-4-6")
    unused = next(w for w in wins if w["type"] == "remove_unused")
    assert unused["tools"] == ["b", "c"]
