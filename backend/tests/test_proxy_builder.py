"""Tests for proxy_builder code generation and tool classification."""

from __future__ import annotations

import ast
import asyncio
import json
from types import SimpleNamespace

from fastmcp import Client

from backend.proxy_builder import _classify_tools, _gen_lookup_consolidation, build_proxy
from backend.tests.conftest import make_tool as _tool


def _build(tools, recommendations=(), quick_wins=()) -> str:
    code, _ = build_proxy(
        tools=tools, upstream_url="https://x/mcp", token_dir="/tmp",
        recommendations=list(recommendations), quick_wins=list(quick_wins),
    )
    return code


class _FakeUpstream:
    def __init__(self):
        self.calls: list[tuple[str, dict]] = []

    async def connect(self):
        pass

    async def disconnect(self):
        pass

    async def call(self, name, args):
        self.calls.append((name, args))
        return {"ok": True}


def _call_generated(code: str, tool: str, arguments: dict) -> _FakeUpstream:
    """Exec the generated proxy module and call one tool through FastMCP."""
    ns: dict = {"__name__": "generated_proxy"}
    exec(compile(code, "<proxy>", "exec"), ns)
    fake = _FakeUpstream()
    ns["upstream"] = fake  # lifespan and tool bodies read the module global

    async def run():
        async with Client(ns["mcp"]) as c:
            await c.call_tool(tool, arguments)

    asyncio.run(run())
    return fake


def _func_args(code: str, fn_name: str) -> list[str]:
    for node in ast.walk(ast.parse(code)):
        if isinstance(node, ast.AsyncFunctionDef) and node.name == fn_name:
            a = node.args
            return [x.arg for x in a.posonlyargs + a.args + a.kwonlyargs]
    raise AssertionError(f"{fn_name} not found")


# --- keyword-only params (required after optional) ---

def test_passthrough_required_after_optional_compiles():
    tools = [_tool(
        "search",
        {"limit": {"type": "integer"}, "query": {"type": "string"}},
        required=["query"],
    )]
    code = _build(tools)
    compile(code, "<proxy>", "exec")
    fake = _call_generated(code, "search", {"query": "q"})
    assert fake.calls == [("search", {"query": "q"})]


def test_prefix_consolidation_required_after_optional_compiles():
    tools = [
        _tool("db_a", {"limit": {"type": "integer"}, "query": {"type": "string"}}, ["query"]),
        _tool("db_b", {"limit": {"type": "integer"}, "query": {"type": "string"}}, ["query"]),
    ]
    recs = [{
        "id": "rec_1",
        "type": "consolidate",
        "source_tools": ["db_a", "db_b"],
        "target_tool": {"name": "db", "description": "d", "parameters": {}},
    }]
    code = _build(tools, recs)
    fake = _call_generated(code, "db", {"action": "db_b", "query": "q"})
    assert fake.calls == [("db_b", {"query": "q"})]


def test_passthrough_no_params_compiles():
    code = _build([_tool("ping")])
    assert _func_args(code, "ping") == []


# --- params can't shadow module globals ---

def test_param_named_json_or_upstream_does_not_shadow_globals():
    tools = [_tool(
        "t",
        {"json": {"type": "string"}, "upstream": {"type": "string"}},
        required=["json"],
    )]
    code = _build(tools)
    args = _func_args(code, "t")
    assert "json" not in args and "upstream" not in args
    fake = _call_generated(code, "t", {"json_2": "a", "upstream_2": "b"})
    # Original JSON keys are preserved for the upstream call.
    assert fake.calls == [("t", {"json": "a", "upstream": "b"})]


# --- classification precedence ---

def test_rewrite_does_not_override_consolidate_or_remove():
    tools = [_tool("a_x"), _tool("a_y"), _tool("gone"), _tool("plain")]
    recs = [
        {"type": "consolidate", "source_tools": ["a_x", "a_y"], "target_tool": {"name": "a"}},
        {"type": "remove", "source_tools": ["gone"]},
    ]
    qws = [{"type": "trim_descriptions", "tools": ["a_x", "gone", "plain"]}]
    c = _classify_tools(tools, recs, qws)
    assert c["a_x"]["status"] == "consolidated_prefix"
    assert c["a_y"]["status"] == "consolidated_prefix"
    assert c["gone"]["status"] == "removed"
    assert c["plain"]["status"] == "description_rewritten"


def test_lookup_rec_schema_classifies_as_lookup():
    tools = [_tool("get_a"), _tool("get_b"), _tool("get_c")]
    names = [t.name for t in tools]
    recs = [{
        "type": "consolidate",
        "source_tools": names,
        "target_tool": {
            "name": "lookup",
            "parameters": {
                "type": "object",
                "properties": {"table": {"type": "string", "enum": names}},
                "required": ["table"],
            },
        },
    }]
    c = _classify_tools(tools, recs, [])
    assert all(c[n]["status"] == "consolidated_lookup" for n in names)


# --- lookup consolidation ---

def _lookup_map(lines: list[str]) -> dict:
    src = "\n".join(lines)
    start = src.index("= ") + 2
    return json.loads(src[start:src.index("\n\n")])


def test_lookup_short_name_collision_keeps_full_names():
    rec = {"source_tools": ["get_foo", "list_foo", "get_bar", "baz", "get_baz"]}
    m = _lookup_map(_gen_lookup_consolidation(rec, set()))
    assert m == {
        "get_foo": "get_foo",
        "list_foo": "list_foo",
        "bar": "get_bar",
        "baz": "baz",
        "get_baz": "get_baz",
    }


def test_two_lookup_recs_get_distinct_maps():
    tools = [_tool(n) for n in ("get_a", "get_b", "get_c", "get_d")]
    recs = [{"type": "consolidate_lookups", "source_tools": ["get_a", "get_b"]}]
    qws = [{"type": "consolidate_lookups", "source_tools": ["get_c", "get_d"]}]
    code = _build(tools, recs, qws)
    assert "LOOKUP_TABLES = " in code and "LOOKUP_2_TABLES = " in code
    fake = _call_generated(code, "lookup_2", {"table": "c"})
    assert fake.calls == [("get_c", {})]


def test_stats_total_counts_proxied_tools():
    tools = [_tool("db_a"), _tool("db_b"), _tool("db_c"), _tool("gone"), _tool("plain")]
    recs = [
        {"type": "consolidate", "source_tools": ["db_a", "db_b", "db_c"], "target_tool": {"name": "db"}},
        {"type": "remove", "source_tools": ["gone"]},
    ]
    _, stats = build_proxy(
        tools=tools, upstream_url="https://x/mcp", token_dir="/tmp",
        recommendations=recs, quick_wins=[],
    )
    assert stats == {"total": 2, "upstream": 5, "removed": 1, "consolidated": 3, "passthrough": 1}


def test_passthrough_keeps_full_description():
    desc = "line one\nline \"two\"\n" + "x" * 800
    tool = SimpleNamespace(name="t", description=desc, inputSchema={"type": "object", "properties": {}})
    code = _build([tool])
    ns: dict = {"__name__": "generated_proxy"}
    exec(compile(code, "<proxy>", "exec"), ns)

    async def get_desc():
        async with Client(ns["mcp"]) as c:
            return (await c.list_tools())[0].description

    ns["upstream"] = _FakeUpstream()
    assert asyncio.run(get_desc()) == desc


def test_removed_and_disabled_tools_absent_from_consolidations():
    tools = [_tool(n) for n in ("get_a", "get_b", "get_c", "db_x", "db_y", "db_z")]
    recs = [{"type": "consolidate", "source_tools": ["db_x", "db_y", "db_z"], "target_tool": {"name": "db"}}]
    qws = [
        {"type": "consolidate_lookups", "tools": ["get_a", "get_b", "get_c"]},
        {"type": "remove_unused", "tools": ["get_b", "db_y"]},
    ]
    code, stats = build_proxy(
        tools=tools, upstream_url="https://x/mcp", token_dir="/tmp",
        recommendations=recs, quick_wins=qws, disabled_tools=["get_c", "db_z"],
    )
    ns: dict = {"__name__": "generated_proxy"}
    exec(compile(code, "<proxy>", "exec"), ns)
    assert ns["LOOKUP_TABLES"] == {"a": "get_a"}
    assert '"db_y"' not in code and '"db_z"' not in code
    assert '"db_x": "db_x"' in code
    assert stats["removed"] == 4
