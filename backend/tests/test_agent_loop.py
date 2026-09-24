"""Evaluate SSE contract and the shared agent loop, driven by a fake LLM."""

from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace

import pytest

from backend import mcp_manager
from backend.llm_client import LLMResponse, ToolCall
from backend.models import EvaluateRequest
from backend.routes import optimize
from backend.state import session

TOOL = SimpleNamespace(
    name="search_records",
    description="Searches the record store",
    inputSchema={"type": "object", "properties": {"query": {"type": "string"}}},
)


class _FakeLLM:
    """Round 1: text + one tool call. Round 2: final answer."""

    def __init__(self):
        self.rounds = [
            (["Let me look"], LLMResponse(
                text="Let me look",
                tool_calls=[ToolCall(id="t1", name="search_records", input={"query": "x"})],
                input_tokens=100, output_tokens=10,
            )),
            (["Done"], LLMResponse(text="Done", input_tokens=150, output_tokens=5)),
        ]
        self.seen_messages: list[list] = []

    async def chat_stream(self, messages, tools, max_tokens):
        self.seen_messages.append(list(messages))
        deltas, response = self.rounds.pop(0)
        for d in deltas:
            yield d
        yield response

    async def chat(self, messages, tools, max_tokens):
        self.seen_messages.append(list(messages))
        return self.rounds.pop(0)[1]

    def to_anthropic_blocks(self, response):
        return [{"type": "tool_use", "id": tc.id, "name": tc.name, "input": tc.input}
                for tc in response.tool_calls]


async def _fake_call_tool(name, arguments):
    return SimpleNamespace(content=[SimpleNamespace(text='{"a": 1}')])


@pytest.fixture
def fake_session(monkeypatch):
    for attr, value in {
        "tools": [TOOL], "eval_results": [], "traces": [], "prompts": [],
        "loaded_resources": {}, "api_key": "", "api_key_provider": "",
        "api_key_endpoint": "", "provider": "anthropic", "custom_endpoint": "",
        "model": "claude-sonnet-4-6",
    }.items():
        monkeypatch.setattr(session, attr, value)
    monkeypatch.setattr(mcp_manager, "is_connected", lambda: True)
    monkeypatch.setattr(mcp_manager, "call_tool", _fake_call_tool)
    llm = _FakeLLM()
    monkeypatch.setattr(optimize, "LLMClient", lambda *a, **k: llm)
    return llm


def _parse_sse(chunks: list[str]) -> list[tuple[str, dict]]:
    events = []
    for chunk in chunks:
        head, data = chunk.strip().split("\n", 1)
        events.append((head.removeprefix("event: "), json.loads(data.removeprefix("data: "))))
    return events


def _run_evaluate(prompt: str) -> list[tuple[str, dict]]:
    async def run():
        resp = await optimize.evaluate(EvaluateRequest(prompt=prompt, api_key="k", provider="anthropic"))
        return [chunk async for chunk in resp.body_iterator]
    return _parse_sse(asyncio.run(run()))


def test_evaluate_event_sequence(fake_session):
    events = _run_evaluate("find x")
    assert [e for e, _ in events] == [
        "thinking", "text_delta", "context_update", "tool_calling", "tool_result",
        "thinking", "text_delta", "context_update", "done",
    ]
    data = [d for _, d in events]

    # Initial estimate: tool menu + the prompt message.
    menu = len("search_records: Searches the record store") // 4 + len(json.dumps(TOOL.inputSchema)) // 4
    assert data[0] == {"step": 0, "context_tokens": menu + max(1, len("find x") // 4)}
    assert data[1] == {"text": "Let me look"}
    assert data[2] == {"context_tokens": 100, "source": "api"}
    assert data[3] == {"step": 1, "tool": "search_records", "input": {"query": "x"}}
    # delta = tokens(input json) + tokens(result text)
    delta = max(1, len('{"query": "x"}') // 4) + max(1, len('{"a": 1}') // 4)
    tool_result = data[4]
    assert tool_result.pop("duration") >= 0
    assert tool_result == {
        "step": 1, "tool": "search_records", "input": {"query": "x"},
        "output": '{"a": 1}', "error": None, "context_tokens": 100 + delta,
    }
    assert data[5] == {"step": 1, "context_tokens": 100 + delta}
    assert data[6] == {"text": "Done"}
    assert data[7] == {"context_tokens": 150, "source": "api"}

    done = data[8]
    assert done["prompt"] == "find x"
    assert done["answer"] == "Done"
    assert done["index"] == 0
    assert done["usage"] == {
        "input_tokens": 250, "output_tokens": 15, "total_tokens": 265,
        "peak_context_tokens": 150, "api_rounds": 2,
    }
    assert done["toolChain"] == [dict(tool_result, duration=done["toolChain"][0]["duration"])]
    trace = done["traceEvents"][0]
    assert trace["step"] == 0
    assert trace["tool_name"] == "search_records"
    assert trace["tool_response_fields"] == ["a"]
    assert trace["error_category"] is None

    stored = session.eval_results[0]
    assert stored["answer"] == "Done"
    assert session.traces == done["traceEvents"]
    # This eval's replayable messages: prompt, tool_use, tool_result, final answer.
    assert [m["role"] for m in stored["raw_messages"]] == ["user", "assistant", "user", "assistant"]


def test_evaluate_max_rounds(fake_session):
    async def run():
        req = EvaluateRequest(prompt="p", api_key="k", provider="anthropic", max_tool_rounds=1)
        resp = await optimize.evaluate(req)
        return [chunk async for chunk in resp.body_iterator]
    events = _parse_sse(asyncio.run(run()))
    names = [e for e, _ in events]
    assert names[-2:] == ["error", "done"]
    assert events[-2][1] == {"message": "Max tool call rounds (1) exceeded"}
    assert events[-1][1]["answer"].startswith("[Stopped after 1 tool call rounds")


def test_agent_loop_non_streaming_counts_steps_per_loop():
    llm = _FakeLLM()
    run = optimize._AgentRun(messages=[{"role": "user", "content": "p"}])

    async def go():
        return [e async for e in optimize._run_agent_loop(
            run, llm, [], _fake_call_tool, max_rounds=5, max_tokens=10, stream=False,
        )]

    events = asyncio.run(go())
    assert "text_delta" not in [e for e, _ in events]
    assert run.final_answer == "Done"
    assert [t["step"] for t in run.trace_events] == [1]
    assert run.input_tokens == 250
