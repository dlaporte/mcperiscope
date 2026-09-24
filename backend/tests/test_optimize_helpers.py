"""Tests for pure helpers in routes/optimize.py."""

from __future__ import annotations

import anthropic
import httpx
import openai

from backend.routes.optimize import _analyst_pairs, _llm_error_message


def test_analyst_pairs_use_original_eval_index():
    evals = [{"answer": "a0"}, {"answer": "a1"}, {"answer": "a2"}]
    # Only evals 0 and 2 were included in the proxy re-run.
    proxy_answers = [
        {"index": 0, "prompt": "p0", "answer": "x0"},
        {"index": 2, "prompt": "p2", "answer": "x2"},
    ]
    assert _analyst_pairs(proxy_answers, evals) == [
        ("p0", "a0", "x0"),
        ("p2", "a2", "x2"),
    ]


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
