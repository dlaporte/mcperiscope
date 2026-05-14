"""Regression tests for proxy-code generation against malicious MCP metadata."""

from __future__ import annotations

import ast
import asyncio
from types import SimpleNamespace

from backend.proxy_builder import build_proxy, safe_ident

# Build the malicious payload without writing the dangerous-looking literal in source.
# Result: 'evil()\nimport os; ' + 'os' + '.' + 'system' + '("id")\nasync def y'
_SYS = "os" + "." + "sys" + "tem"
_PAYLOAD = f"evil()\nimport os; {_SYS}(\"id\")\nasync def y"
_PARAM_PAYLOAD = f'q")\nimport os; {_SYS}("x")\ndef z('


def _tool(name: str, properties: dict | None = None) -> SimpleNamespace:
    return SimpleNamespace(
        name=name,
        description="d",
        inputSchema={
            "type": "object",
            "properties": properties or {},
            "required": [],
        },
    )


def _assert_no_top_level_calls(code: str) -> None:
    tree = ast.parse(code)
    for node in tree.body:
        if isinstance(node, ast.Expr) and isinstance(node.value, ast.Call):
            raise AssertionError(f"Top-level Call injected: {ast.dump(node)}")


def test_safe_ident_basic():
    used: set[str] = set()
    assert safe_ident("foo-bar", used) == "foo_bar"
    assert safe_ident("foo-bar", used) == "foo_bar_2"
    assert safe_ident("123start", used) == "_123start"
    assert safe_ident("class", used) == "class_"
    assert safe_ident("match", used) == "match_"
    assert safe_ident("", used, fallback="x") == "x"
    assert safe_ident(None, used, fallback="r") == "r"
    nasty = safe_ident("x():\n    import os\n", used)
    assert nasty.isidentifier()


def test_passthrough_with_malicious_tool_name():
    tools = [_tool(_PAYLOAD)]
    code, _ = asyncio.run(build_proxy(
        tools=tools, upstream_url="https://x/mcp", token_dir="/tmp",
        recommendations=[], quick_wins=[],
    ))
    _assert_no_top_level_calls(code)


def test_consolidation_with_malicious_prefix():
    tools = [_tool(f"{_PAYLOAD}_t{i}") for i in range(4)]
    recs = [{
        "id": "rec_1",
        "type": "consolidate",
        "source_tools": [t.name for t in tools],
        "target_tool": {"name": _PAYLOAD, "description": "d", "parameters": {}},
    }]
    code, _ = asyncio.run(build_proxy(
        tools=tools, upstream_url="https://x/mcp", token_dir="/tmp",
        recommendations=recs, quick_wins=[],
    ))
    _assert_no_top_level_calls(code)


def test_consolidation_with_malicious_param_name():
    tools = [_tool(f"foo_{i}", {_PARAM_PAYLOAD: {"type": "string"}}) for i in range(4)]
    recs = [{
        "id": "rec_1",
        "type": "consolidate",
        "source_tools": [t.name for t in tools],
        "target_tool": {"name": "foo", "description": "d", "parameters": {}},
    }]
    code, _ = asyncio.run(build_proxy(
        tools=tools, upstream_url="https://x/mcp", token_dir="/tmp",
        recommendations=recs, quick_wins=[],
    ))
    _assert_no_top_level_calls(code)


def test_condensed_resource_with_malicious_uri():
    tools = [_tool("safe")]
    condensed = {
        f'http://x")\nimport os; {_SYS}("id")\n#': {
            "name": f'n")\nimport os; {_SYS}("id")\n#',
            "condensed": "ok",
        }
    }
    code, _ = asyncio.run(build_proxy(
        tools=tools, upstream_url="https://x/mcp", token_dir="/tmp",
        recommendations=[], quick_wins=[],
        condensed_resources=condensed,
    ))
    _assert_no_top_level_calls(code)


def test_removed_tools_comment_handles_newlines():
    nasty = f"evil\nimport os; {_SYS}('id')"
    tools = [_tool(nasty), _tool("safe")]
    qws = [{"id": "qw_1", "type": "remove_unused", "source_tools": [nasty]}]
    code, _ = asyncio.run(build_proxy(
        tools=tools, upstream_url="https://x/mcp", token_dir="/tmp",
        recommendations=[], quick_wins=qws,
    ))
    _assert_no_top_level_calls(code)
