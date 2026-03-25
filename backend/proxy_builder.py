"""Modular proxy code assembler for MCPeriscope.

Builds an optimized MCP proxy from deterministic code templates.
The LLM is only used for batch description rewriting (one call for all tools).
Everything else is string assembly with compile() validation.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Type helpers
# ---------------------------------------------------------------------------

_JSON_TYPE_MAP = {
    "string": "str",
    "integer": "int",
    "number": "float",
    "boolean": "bool",
    "array": "list",
    "object": "dict",
}


def _py_type(prop_schema: dict[str, Any]) -> str:
    return _JSON_TYPE_MAP.get(prop_schema.get("type", "string"), "str")


def _quote(s: str) -> str:
    """Return a safely-quoted Python string literal."""
    return json.dumps(s)


# ---------------------------------------------------------------------------
# Tool classification
# ---------------------------------------------------------------------------

def _classify_tools(
    tools: list,
    recommendations: list[dict],
    quick_wins: list[dict],
) -> dict[str, dict]:
    """Classify each tool based on enabled recommendations.

    Returns a dict: tool_name -> {
        "status": "removed" | "consolidated_lookup" | "consolidated_prefix" | "description_rewritten" | "passthrough",
        "rec": <the recommendation dict, if applicable>,
    }
    """
    classification: dict[str, dict] = {}

    # First pass: mark all tools as passthrough
    for t in tools:
        classification[t.name] = {"status": "passthrough", "rec": None}

    all_recs = recommendations + quick_wins

    for rec in all_recs:
        rec_type = rec.get("type", "")
        source_tools = rec.get("source_tools", []) or rec.get("tools", [])
        affected_tools = rec.get("affected_tools", [])

        # Remove tools (behavior "remove" or inventory "remove_unused")
        if rec_type in ("remove", "remove_unused"):
            for name in source_tools:
                if name in classification:
                    classification[name] = {"status": "removed", "rec": rec}

        # Consolidate lookups (inventory "consolidate_lookups")
        elif rec_type == "consolidate_lookups":
            for name in source_tools:
                if name in classification:
                    classification[name] = {"status": "consolidated_lookup", "rec": rec}

        # Consolidate by prefix (behavior "consolidate")
        elif rec_type == "consolidate":
            target = rec.get("target_tool") or {}
            params = target.get("parameters", {})
            props = params.get("properties", {}) if isinstance(params, dict) else {}

            if "table" in props and "enum" in props.get("table", {}):
                for name in source_tools:
                    if name in classification:
                        classification[name] = {"status": "consolidated_lookup", "rec": rec}
            else:
                for name in source_tools:
                    if name in classification:
                        classification[name] = {"status": "consolidated_prefix", "rec": rec}

        # Rewrite descriptions (behavior "rewrite_description" or inventory "trim_descriptions")
        elif rec_type in ("rewrite_description", "trim_descriptions"):
            for name in source_tools:
                if name in classification:
                    classification[name] = {"status": "description_rewritten", "rec": rec}

    return classification


# ---------------------------------------------------------------------------
# Code generators for each section
# ---------------------------------------------------------------------------

def _gen_header(upstream_url: str, token_dir: str) -> list[str]:
    """Generate the proxy header with imports, upstream client, lifespan, mcp."""
    return [
        '"""Auto-generated MCP proxy server by MCPeriscope."""',
        "",
        "from __future__ import annotations",
        "import argparse",
        "import json",
        "from contextlib import asynccontextmanager",
        "from fastmcp import FastMCP",
        "from backend.mcp_optimizer.proxy_runtime import UpstreamClient",
        "",
        f"UPSTREAM_URL = {json.dumps(upstream_url)}",
        f"TOKEN_DIR = {json.dumps(token_dir)}",
        "",
        "upstream = UpstreamClient(UPSTREAM_URL, token_dir=TOKEN_DIR)",
        "",
        "@asynccontextmanager",
        "async def lifespan(app):",
        "    await upstream.connect()",
        "    try:",
        "        yield",
        "    finally:",
        "        await upstream.disconnect()",
        "",
        'mcp = FastMCP("mcperiscope-proxy", lifespan=lifespan)',
        "",
    ]


def _gen_lookup_consolidation(
    rec: dict,
    tools: list,
    rewritten_descriptions: dict[str, str] | None = None,
) -> list[str]:
    """Generate a consolidated lookup() tool for no-param reference tools."""
    source_tools = rec.get("source_tools", []) or rec.get("tools", [])
    target = rec.get("target_tool") or {}

    # Build the lookup map: short_name -> upstream_tool_name
    lookup_map: dict[str, str] = {}
    for name in source_tools:
        short = name
        for prefix in ["get_", "list_", "fetch_", "lookup_"]:
            if short.startswith(prefix):
                short = short[len(prefix):]
                break
        lookup_map[short] = name

    desc = target.get("description", f"Consolidated lookup for {len(source_tools)} reference data tools")
    table_list = ", ".join(sorted(lookup_map.keys()))

    lines = [
        f"LOOKUP_TOOLS = {json.dumps(lookup_map, indent=2)}",
        "",
        f'@mcp.tool(description={_quote(desc)})',
        "async def lookup(table: str) -> str:",
        f'    """Look up reference data by table name. Available tables: {table_list}"""',
        "    if table not in LOOKUP_TOOLS:",
        '        return json.dumps({"error": f"Unknown table: {table}. Available: {sorted(LOOKUP_TOOLS.keys())}"})',
        "    result = await upstream.call(LOOKUP_TOOLS[table], {})",
        "    return json.dumps(result) if not isinstance(result, str) else result",
        "",
    ]
    return lines


def _gen_prefix_consolidation(
    rec: dict,
    tools: list,
    rewritten_descriptions: dict[str, str] | None = None,
) -> list[str]:
    """Generate a consolidated dispatch tool for prefix-grouped tools."""
    source_tools = rec.get("source_tools", []) or rec.get("tools", [])
    target = rec.get("target_tool") or {}
    target_name = target.get("name", "consolidated_tool")
    desc = target.get("description", f"Consolidated tool for: {', '.join(source_tools)}")

    # Build tool_name -> tool object map
    tool_map = {t.name: t for t in tools}

    # Build dispatch map: action_value -> upstream_tool_name
    # The action value is the tool name itself (matches analyze.py's _merged_params)
    dispatch_map = {name: name for name in source_tools if name in tool_map}

    # Collect the union of all parameters across source tools
    all_properties: dict[str, Any] = {}
    all_required: set[str] = set()
    first = True
    for tool_name in source_tools:
        tool = tool_map.get(tool_name)
        if not tool:
            continue
        schema = tool.inputSchema or {}
        props = schema.get("properties", {})
        req = set(schema.get("required", []))
        for k, v in props.items():
            if k not in all_properties:
                all_properties[k] = v
        if first:
            all_required = req
            first = False
        else:
            all_required &= req

    # Build function signature: action first, then union of other params
    param_parts = ["action: str"]
    for pname, pschema in all_properties.items():
        ptype = _py_type(pschema)
        if pname in all_required:
            param_parts.append(f"{pname}: {ptype}")
        else:
            param_parts.append(f"{pname}: {ptype} | None = None")
    params = ", ".join(param_parts)

    # Build args dict (all params except action)
    arg_keys = list(all_properties.keys())
    if arg_keys:
        dict_entries = ", ".join(f'"{k}": {k}' for k in arg_keys)
        args_build = f"    args = {{{dict_entries}}}"
        args_clean = "    args = {k: v for k, v in args.items() if v is not None}"
    else:
        args_build = "    args = {}"
        args_clean = ""

    dispatch_map_repr = json.dumps(dispatch_map, indent=4)
    action_list_repr = json.dumps(sorted(dispatch_map.keys()))

    lines = [
        f"@mcp.tool(description={_quote(desc)})",
        f"async def {target_name}({params}) -> str:",
        f'    """Consolidated tool dispatching to upstream based on action."""',
        f"    dispatch_map = {dispatch_map_repr}",
        "    if action not in dispatch_map:",
        f"        return json.dumps({{\"error\": \"Unknown action: \" + action + \". Must be one of: \" + \", \".join(sorted(dispatch_map.keys()))}})",
        "    upstream_tool = dispatch_map[action]",
        args_build,
    ]
    if args_clean:
        lines.append(args_clean)
    lines.extend([
        "    result = await upstream.call(upstream_tool, args)",
        "    return json.dumps(result) if not isinstance(result, str) else result",
        "",
    ])
    return lines


def _gen_passthrough(
    tool,
    rewritten_descriptions: dict[str, str] | None = None,
) -> list[str]:
    """Generate a passthrough wrapper for a single tool."""
    schema = tool.inputSchema or {}
    props = schema.get("properties", {})
    required_set = set(schema.get("required", []))

    # Use rewritten description if available, otherwise truncate original
    if rewritten_descriptions and tool.name in rewritten_descriptions:
        desc = rewritten_descriptions[tool.name]
    else:
        desc = (tool.description or "")[:500]
    desc = desc.replace("\n", " ")
    desc_json = json.dumps(desc)

    # Sanitize tool name for use as Python function name
    safe_name = re.sub(r'[^a-zA-Z0-9_]', '_', tool.name)
    if safe_name[0:1].isdigit():
        safe_name = f"tool_{safe_name}"

    params = []
    args_entries = []
    for pname, pschema in props.items():
        ptype = _py_type(pschema)
        safe_pname = re.sub(r'[^a-zA-Z0-9_]', '_', pname)
        if pname in required_set:
            params.append(f"{safe_pname}: {ptype}")
        else:
            params.append(f"{safe_pname}: {ptype} | None = None")
        args_entries.append(f'{json.dumps(pname)}: {safe_pname}')

    param_str = ", ".join(params)
    args_str = "{" + ", ".join(args_entries) + "}" if args_entries else "{}"

    lines = [
        f'@mcp.tool(description={desc_json})',
        f"async def {safe_name}({param_str}) -> str:",
        f"    args = {{k: v for k, v in {args_str}.items() if v is not None}}",
        f'    result = await upstream.call({json.dumps(tool.name)}, args)',
        f"    return json.dumps(result) if not isinstance(result, str) else result",
        "",
    ]
    return lines


def _gen_condensed_resources(condensed_resources: dict) -> list[str]:
    """Generate @mcp.resource handlers for condensed resources."""
    lines = ["# --- Condensed resource handlers ---"]
    for uri, data in condensed_resources.items():
        safe_name = re.sub(r'[^a-zA-Z0-9_]', '_', data["name"])
        lines.append(f'@mcp.resource("{uri}")')
        lines.append(f"async def resource_{safe_name}() -> str:")
        lines.append(f'    """Condensed version of {data["name"]}"""')
        lines.append(f"    return {json.dumps(data['condensed'])}")
        lines.append("")
    return lines


def _gen_entry_point() -> list[str]:
    """Generate the __main__ entry point."""
    return [
        'if __name__ == "__main__":',
        '    parser = argparse.ArgumentParser()',
        '    parser.add_argument("--port", type=int, default=8000)',
        '    args = parser.parse_args()',
        '    mcp.run(transport="streamable-http", port=args.port)',
    ]


# ---------------------------------------------------------------------------
# Batch description rewriting (the ONE LLM call)
# ---------------------------------------------------------------------------

async def batch_rewrite_descriptions(
    tools_to_rewrite: list,
    analyst_key: str,
    analyst_model: str,
    analyst_provider: str = "",
    analyst_endpoint: str = "",
) -> dict[str, str]:
    """Rewrite all tool descriptions in a single LLM call.

    Args:
        tools_to_rewrite: List of tool objects whose descriptions need rewriting.
        analyst_key: API key for the analyst LLM.
        analyst_model: Model name for the analyst LLM.
        analyst_provider: Provider for the analyst LLM.
        analyst_endpoint: Custom endpoint for the analyst LLM.

    Returns:
        Dict mapping tool_name -> rewritten description.
    """
    from backend.llm_client import LLMClient

    if not tools_to_rewrite:
        return {}

    # Build the prompt with all descriptions
    tool_sections = []
    for t in tools_to_rewrite:
        tool_sections.append(
            f"Tool: {t.name}\nCurrent: {(t.description or '')[:1000]}"
        )

    prompt = (
        "Rewrite each tool description to be more concise (under 100 tokens) "
        "while preserving what the tool does and its key parameters. "
        "Keep essential information about return values and when to use the tool.\n\n"
        + "\n\n".join(tool_sections)
        + "\n\nRespond with ONLY valid JSON: {\"tool_name\": \"concise description\", ...}"
    )

    analyst = LLMClient(analyst_key, analyst_model, analyst_provider, analyst_endpoint)
    response = await analyst.chat(
        messages=[{"role": "user", "content": prompt}],
        max_tokens=4096,
    )

    text = response.text.strip()

    # Strip markdown code fences if present
    if text.startswith("```"):
        lines = text.split("\n")
        lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        text = "\n".join(lines)

    try:
        result = json.loads(text)
        if isinstance(result, dict):
            return {k: str(v) for k, v in result.items()}
    except (json.JSONDecodeError, TypeError):
        logger.warning("Failed to parse LLM description rewrite response, using originals")

    return {}


# ---------------------------------------------------------------------------
# Main builder
# ---------------------------------------------------------------------------

async def build_proxy(
    tools: list,
    upstream_url: str,
    token_dir: str,
    recommendations: list[dict],
    quick_wins: list[dict],
    condensed_resources: dict | None = None,
    rewritten_descriptions: dict[str, str] | None = None,
) -> tuple[str, dict]:
    """Assemble proxy code from modular templates.

    This is entirely deterministic (no LLM calls). The optional
    rewritten_descriptions dict should be obtained beforehand via
    batch_rewrite_descriptions() if description rewriting is needed.

    Args:
        tools: List of mcp.types.Tool objects from the upstream server.
        upstream_url: URL of the upstream MCP server.
        token_dir: Directory for OAuth token storage.
        recommendations: Behavior recommendations from analysis.
        quick_wins: Quick win recommendations from inventory analysis.
        condensed_resources: Dict of uri -> {name, condensed, ...} for resource handlers.
        rewritten_descriptions: Dict of tool_name -> new description text.

    Returns:
        A tuple of (source_code, stats_dict) where stats_dict has keys:
        total, removed, consolidated, passthrough.
    """
    rewritten_descriptions = rewritten_descriptions or {}

    # Classify each tool
    classification = _classify_tools(tools, recommendations, quick_wins)

    # Count stats
    removed_count = sum(1 for c in classification.values() if c["status"] == "removed")
    consolidated_count = sum(
        1 for c in classification.values()
        if c["status"] in ("consolidated_lookup", "consolidated_prefix")
    )
    passthrough_count = sum(
        1 for c in classification.values()
        if c["status"] in ("passthrough", "description_rewritten")
    )

    # Assemble code
    lines = _gen_header(upstream_url, token_dir)

    # Track which consolidation recs we've already generated
    generated_consolidation_ids: set[str] = set()

    # Generate lookup consolidations
    for tool_name, info in classification.items():
        if info["status"] != "consolidated_lookup":
            continue
        rec = info["rec"]
        rec_id = id(rec)  # Use object id since recs may not have a stable "id" key
        if rec_id in generated_consolidation_ids:
            continue
        generated_consolidation_ids.add(rec_id)
        lines.extend(_gen_lookup_consolidation(rec, tools, rewritten_descriptions))

    # Generate prefix consolidations
    for tool_name, info in classification.items():
        if info["status"] != "consolidated_prefix":
            continue
        rec = info["rec"]
        rec_id = id(rec)
        if rec_id in generated_consolidation_ids:
            continue
        generated_consolidation_ids.add(rec_id)
        lines.extend(_gen_prefix_consolidation(rec, tools, rewritten_descriptions))

    # Generate condensed resources
    if condensed_resources:
        lines.extend(_gen_condensed_resources(condensed_resources))

    # Generate passthrough + description-rewritten tools
    passthrough_lines = []
    for t in tools:
        status = classification.get(t.name, {}).get("status", "passthrough")
        if status in ("passthrough", "description_rewritten"):
            passthrough_lines.extend(_gen_passthrough(t, rewritten_descriptions))

    if passthrough_lines:
        lines.append("# --- Passthrough tools (unmodified) ---")
        lines.append("")
        lines.extend(passthrough_lines)

    # Removed tools comment
    removed_tools = [name for name, info in classification.items() if info["status"] == "removed"]
    if removed_tools:
        lines.append(f"# Removed tools: {', '.join(removed_tools)}")
        lines.append("")

    # Entry point
    lines.extend(_gen_entry_point())

    code = "\n".join(lines)

    # Validate syntax
    try:
        compile(code, "<proxy>", "exec")
    except SyntaxError as e:
        raise RuntimeError(f"Generated proxy has syntax error at line {e.lineno}: {e.msg}")

    return code, {
        "total": len(tools),
        "removed": removed_count,
        "consolidated": consolidated_count,
        "passthrough": passthrough_count,
    }
