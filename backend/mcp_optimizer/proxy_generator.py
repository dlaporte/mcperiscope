"""Generate a complete, runnable FastMCP proxy server from approved recommendations.

Takes a list of approved optimization recommendations and the full tool inventory
from a target MCP server, and produces a Python source file that acts as an
optimized proxy — consolidating, trimming, rewriting, or removing tools as
directed while passing all other tools through unchanged.
"""

from __future__ import annotations

import json
import textwrap
from typing import Any


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _indent(code: str, level: int = 1) -> str:
    """Indent a block of code by *level* four-space stops."""
    prefix = "    " * level
    return "\n".join(prefix + line if line.strip() else "" for line in code.splitlines())


def _quote(s: str) -> str:
    """Return a safely-quoted Python string literal."""
    return json.dumps(s)  # JSON strings are valid Python string literals


def _build_param_schema(tool) -> dict[str, Any]:
    """Extract the inputSchema from an mcp.types.Tool as a plain dict."""
    schema = tool.inputSchema
    if hasattr(schema, "model_dump"):
        return schema.model_dump()
    if isinstance(schema, dict):
        return dict(schema)
    return {}


def _schema_properties(tool) -> dict[str, Any]:
    """Return the 'properties' dict from a tool's input schema."""
    schema = _build_param_schema(tool)
    return schema.get("properties", {})


def _schema_required(tool) -> list[str]:
    """Return the 'required' list from a tool's input schema."""
    schema = _build_param_schema(tool)
    return schema.get("required", [])


def _tool_by_name(all_tools: list, name: str):
    """Find a tool by name in the tool list."""
    for t in all_tools:
        if t.name == name:
            return t
    return None


# ---------------------------------------------------------------------------
# Code generators for each optimization type
# ---------------------------------------------------------------------------

def _gen_passthrough(tool, description_override: str | None = None) -> str:
    """Generate a passthrough tool that simply forwards to upstream."""
    name = tool.name
    desc = description_override or (tool.description or "")
    schema = _build_param_schema(tool)
    properties = schema.get("properties", {})
    required = schema.get("required", [])

    # Build function parameters
    params = _build_function_params(properties, required)
    args_dict = _build_args_dict(properties)

    lines = []
    lines.append(f"@mcp.tool(description={_quote(desc)})")
    lines.append(f"async def {name}({params}) -> str:")
    lines.append(f'    """Proxy for upstream tool {_quote(name)}."""')
    lines.append(f"    result = await upstream.call({_quote(name)}, {args_dict})")
    lines.append(f"    return json.dumps(result) if not isinstance(result, str) else result")
    lines.append("")
    return "\n".join(lines)


def _gen_trim_response(tool, keep_fields: list[str] | None, drop_fields: list[str] | None) -> str:
    """Generate a tool that filters response fields."""
    name = tool.name
    desc = tool.description or ""
    schema = _build_param_schema(tool)
    properties = schema.get("properties", {})
    required = schema.get("required", [])

    params = _build_function_params(properties, required)
    args_dict = _build_args_dict(properties)

    lines = []
    lines.append(f"@mcp.tool(description={_quote(desc)})")
    lines.append(f"async def {name}({params}) -> str:")
    lines.append(f'    """Proxy for upstream tool {_quote(name)} with response filtering."""')
    lines.append(f"    result = await upstream.call({_quote(name)}, {args_dict})")

    if keep_fields:
        fields_repr = repr(keep_fields)
        lines.append(f"    result = FieldFilter.keep_fields(result, {fields_repr})")
    if drop_fields:
        fields_repr = repr(drop_fields)
        lines.append(f"    result = FieldFilter.drop_fields(result, {fields_repr})")

    lines.append(f"    return json.dumps(result) if not isinstance(result, str) else result")
    lines.append("")
    return "\n".join(lines)


def _gen_consolidate(rec: dict, all_tools: list) -> str:
    """Generate a consolidated dispatch tool from multiple source tools."""
    target = rec["target_tool"]
    name = target["name"]
    dispatch_param = target["dispatch_param"]
    dispatch_map = target["dispatch_map"]
    desc = target.get("description", f"Consolidated tool for: {', '.join(rec['source_tools'])}")

    # Collect the union of all parameters across source tools (excluding duplicates)
    all_properties: dict[str, Any] = {}
    all_required: set[str] = set()
    for tool_name in rec["source_tools"]:
        tool = _tool_by_name(all_tools, tool_name)
        if tool:
            props = _schema_properties(tool)
            req = _schema_required(tool)
            for k, v in props.items():
                if k not in all_properties:
                    all_properties[k] = v
            all_required.update(req)

    # Build the enum parameter for dispatching
    enum_values = list(dispatch_map.keys())

    # Build function signature: dispatch_param first, then the rest
    param_parts = [f"{dispatch_param}: str"]
    for pname, pschema in all_properties.items():
        if pname == dispatch_param:
            continue
        ptype = _json_type_to_python(pschema)
        if pname in all_required:
            param_parts.append(f"{pname}: {ptype}")
        else:
            param_parts.append(f"{pname}: {ptype} | None = None")
    params = ", ".join(param_parts)

    # Build the arguments dict (all params except the dispatch param)
    arg_keys = [p for p in all_properties if p != dispatch_param]
    if arg_keys:
        dict_entries = ", ".join(f"{_quote(k)}: {k}" for k in arg_keys)
        args_build = f"    args = {{{dict_entries}}}"
        args_clean = "    args = {k: v for k, v in args.items() if v is not None}"
    else:
        args_build = "    args = {}"
        args_clean = ""

    dispatch_map_repr = repr(dispatch_map)
    enum_repr = repr(enum_values)

    lines = []
    lines.append(f"@mcp.tool(description={_quote(desc)})")
    lines.append(f"async def {name}({params}) -> str:")
    lines.append(f'    """Consolidated tool dispatching to upstream based on {_quote(dispatch_param)}."""')
    lines.append(f"    dispatch_map = {dispatch_map_repr}")
    lines.append(f"    if {dispatch_param} not in dispatch_map:")
    lines.append(f"        raise ValueError(f\"Invalid {{dispatch_param}}: {{{dispatch_param}}}. Must be one of {enum_repr}\")")
    lines.append(f"    upstream_tool = dispatch_map[{dispatch_param}]")
    lines.append(args_build)
    if args_clean:
        lines.append(args_clean)
    lines.append(f"    result = await upstream.call(upstream_tool, args)")
    lines.append(f"    return json.dumps(result) if not isinstance(result, str) else result")
    lines.append("")
    return "\n".join(lines)


def _gen_batch(tool) -> str:
    """Generate a batch tool that accepts a list of argument sets."""
    name = tool.name
    desc = f"Batch version of {name}: accepts a list of argument sets and returns all results."
    batch_name = f"batch_{name}"

    lines = []
    lines.append(f"@mcp.tool(description={_quote(desc)})")
    lines.append(f"async def {batch_name}(items: list[dict]) -> str:")
    lines.append(f'    """Batch proxy: calls upstream {_quote(name)} once per item."""')
    lines.append(f"    results = []")
    lines.append(f"    for item in items:")
    lines.append(f"        result = await upstream.call({_quote(name)}, item)")
    lines.append(f"        results.append(result)")
    lines.append(f"    return json.dumps(results)")
    lines.append("")
    return "\n".join(lines)


def _gen_add_defaults(tool, defaults: dict[str, Any]) -> str:
    """Generate a tool that injects default values before calling upstream."""
    name = tool.name
    desc = tool.description or ""
    schema = _build_param_schema(tool)
    properties = schema.get("properties", {})
    required = schema.get("required", [])

    # Parameters that have defaults become optional in the proxy signature
    params = _build_function_params(properties, required, defaults)
    args_dict = _build_args_dict(properties)

    defaults_repr = repr(defaults)

    lines = []
    lines.append(f"@mcp.tool(description={_quote(desc)})")
    lines.append(f"async def {name}({params}) -> str:")
    lines.append(f'    """Proxy for upstream tool {_quote(name)} with injected defaults."""')
    lines.append(f"    defaults = {defaults_repr}")
    lines.append(f"    args = {args_dict}")
    lines.append(f"    # Inject defaults for any missing/None values")
    lines.append(f"    for k, v in defaults.items():")
    lines.append(f"        if args.get(k) is None:")
    lines.append(f"            args[k] = v")
    lines.append(f"    result = await upstream.call({_quote(name)}, args)")
    lines.append(f"    return json.dumps(result) if not isinstance(result, str) else result")
    lines.append("")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Parameter / type helpers
# ---------------------------------------------------------------------------

def _json_type_to_python(prop_schema: dict[str, Any]) -> str:
    """Map a JSON Schema type to a Python type annotation string."""
    jtype = prop_schema.get("type", "str")
    mapping = {
        "string": "str",
        "integer": "int",
        "number": "float",
        "boolean": "bool",
        "array": "list",
        "object": "dict",
    }
    return mapping.get(jtype, "str")


def _build_function_params(
    properties: dict[str, Any],
    required: list[str],
    defaults: dict[str, Any] | None = None,
) -> str:
    """Build a Python function parameter list from JSON Schema properties."""
    defaults = defaults or {}
    parts: list[str] = []
    # Required params first (excluding those with defaults), then optional
    required_set = set(required)
    for pname, pschema in properties.items():
        ptype = _json_type_to_python(pschema)
        if pname in defaults:
            # Has a default — make optional with the default value
            default_repr = repr(defaults[pname])
            parts.append(f"{pname}: {ptype} = {default_repr}")
        elif pname in required_set:
            parts.append(f"{pname}: {ptype}")
        else:
            parts.append(f"{pname}: {ptype} | None = None")
    return ", ".join(parts)


def _build_args_dict(properties: dict[str, Any]) -> str:
    """Build a dict literal string that collects all parameters into a dict."""
    if not properties:
        return "{}"
    entries = ", ".join(f"{_quote(k)}: {k}" for k in properties)
    return "{" + entries + "}"


# ---------------------------------------------------------------------------
# Main generator
# ---------------------------------------------------------------------------

def generate_proxy_code(
    approved_recommendations: list[dict],
    all_tools: list,  # list of mcp.types.Tool
    upstream_url: str,
) -> str:
    """Generate a complete, runnable FastMCP proxy server.

    Args:
        approved_recommendations: List of approved optimization dicts, each
            containing at minimum ``type`` and ``source_tools``.
        all_tools: Full tool inventory from the upstream MCP server.
        upstream_url: URL of the original MCP server to proxy.

    Returns:
        A string of Python source code for a runnable FastMCP server.
    """

    # Determine which tools are affected by optimizations
    affected_tools: set[str] = set()
    for rec in approved_recommendations:
        for name in rec.get("source_tools", []):
            affected_tools.add(name)

    # --- Header ---
    header = textwrap.dedent(f'''\
        """Auto-generated MCP proxy server.

        Generated by mcp-optimizer. This server proxies an upstream MCP server
        at {upstream_url} with the following optimizations applied.
        """

        from __future__ import annotations

        import argparse
        import json
        from contextlib import asynccontextmanager

        from fastmcp import FastMCP

        from backend.mcp_optimizer.proxy_runtime import FieldFilter, UpstreamClient


        # --- Upstream connection ---
        upstream = UpstreamClient({_quote(upstream_url)})


        @asynccontextmanager
        async def lifespan(app):
            """Connect to upstream on startup, disconnect on shutdown."""
            await upstream.connect()
            try:
                yield
            finally:
                await upstream.disconnect()


        mcp = FastMCP("mcp-optimizer-proxy", lifespan=lifespan)


        # --- Optimized tools ---
    ''')

    tool_blocks: list[str] = []

    # Process each recommendation
    for rec in approved_recommendations:
        rec_type = rec.get("type", "")
        source_tools = rec.get("source_tools", [])

        if rec_type == "remove":
            # Skip removed tools — they won't appear in the proxy
            tool_blocks.append(
                f"# Removed tools: {', '.join(source_tools)}"
            )

        elif rec_type == "consolidate":
            block = _gen_consolidate(rec, all_tools)
            tool_blocks.append(block)

        elif rec_type == "trim_response":
            for tool_name in source_tools:
                tool = _tool_by_name(all_tools, tool_name)
                if tool:
                    block = _gen_trim_response(
                        tool,
                        keep_fields=rec.get("keep_fields"),
                        drop_fields=rec.get("drop_fields"),
                    )
                    tool_blocks.append(block)

        elif rec_type == "rewrite_description":
            new_desc = rec.get("new_description", "")
            for tool_name in source_tools:
                tool = _tool_by_name(all_tools, tool_name)
                if tool:
                    block = _gen_passthrough(tool, description_override=new_desc)
                    tool_blocks.append(block)

        elif rec_type == "batch":
            for tool_name in source_tools:
                tool = _tool_by_name(all_tools, tool_name)
                if tool:
                    # Keep the original as a passthrough too
                    tool_blocks.append(_gen_passthrough(tool))
                    tool_blocks.append(_gen_batch(tool))

        elif rec_type == "add_defaults":
            defaults = rec.get("defaults", {})
            for tool_name in source_tools:
                tool = _tool_by_name(all_tools, tool_name)
                if tool:
                    block = _gen_add_defaults(tool, defaults)
                    tool_blocks.append(block)

    # Generate passthrough tools for everything not affected
    passthrough_blocks: list[str] = []
    for tool in all_tools:
        if tool.name not in affected_tools:
            passthrough_blocks.append(_gen_passthrough(tool))

    if passthrough_blocks:
        passthrough_section = "\n# --- Passthrough tools (unmodified) ---\n\n" + "\n\n".join(passthrough_blocks)
    else:
        passthrough_section = ""

    # --- Footer with __main__ ---
    footer = textwrap.dedent('''\

        # --- Entry point ---

        if __name__ == "__main__":
            parser = argparse.ArgumentParser(description="MCP Optimizer Proxy Server")
            parser.add_argument("--port", type=int, default=8000, help="Port to listen on")
            args = parser.parse_args()
            mcp.run(transport="streamable-http", port=args.port)
    ''')

    # Assemble the full source
    optimized_section = "\n\n".join(tool_blocks) if tool_blocks else "# No optimizations applied."
    source = header + optimized_section + "\n" + passthrough_section + "\n" + footer

    return source
