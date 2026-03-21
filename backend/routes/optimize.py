from __future__ import annotations

import json
import subprocess
import sys
import time
import traceback
import socket

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from backend.models import EvaluateRequest, RatingRequest
from backend.state import session

router = APIRouter()


def _serialize_mcp_result(result) -> str:
    """Convert MCP CallToolResult to a plain text string."""
    parts = []
    if hasattr(result, "content"):
        for block in result.content:
            if hasattr(block, "text"):
                parts.append(block.text)
            elif hasattr(block, "data"):
                parts.append(f"[binary data: {getattr(block, 'mimeType', 'unknown')}]")
            else:
                parts.append(str(block))
    else:
        parts.append(str(result))
    return "\n".join(parts)


def _extract_fields(text: str) -> list[str]:
    """Extract top-level JSON keys from text."""
    try:
        data = json.loads(text)
        if isinstance(data, dict):
            return list(data.keys())
        elif isinstance(data, list) and data and isinstance(data[0], dict):
            return list(data[0].keys())
    except (json.JSONDecodeError, IndexError, TypeError):
        pass
    return []


@router.post("/optimize/evaluate")
async def evaluate(req: EvaluateRequest):
    """Run an evaluation prompt with SSE streaming of tool calls."""
    if not session.connection:
        raise HTTPException(status_code=400, detail="Not connected")
    if not session.api_key:
        raise HTTPException(status_code=400, detail="Anthropic API key not configured")
    if not session.tools:
        raise HTTPException(status_code=400, detail="No tools available")

    async def event_stream():
        import anthropic

        try:
            client = anthropic.Anthropic(api_key=session.api_key)
        except Exception as e:
            yield _sse("error", {"message": f"Failed to initialize Anthropic client: {e}"})
            return

        tools = []
        for t in session.tools:
            tools.append({
                "name": t.name,
                "description": t.description or "",
                "input_schema": t.inputSchema or {"type": "object", "properties": {}},
            })

        messages = [{"role": "user", "content": req.prompt}]
        tool_chain: list[dict] = []
        trace_events: list[dict] = []
        step = 0
        final_answer = ""

        try:
            while True:
                yield _sse("thinking", {"step": step})

                response = client.messages.create(
                    model=session.model,
                    max_tokens=4096,
                    tools=tools,
                    messages=messages,
                )

                tool_use_blocks = [b for b in response.content if b.type == "tool_use"]
                text_blocks = [b for b in response.content if b.type == "text"]

                if not tool_use_blocks:
                    final_answer = "\n".join(b.text for b in text_blocks)
                    break

                messages.append({
                    "role": "assistant",
                    "content": [_block_to_dict(b) for b in response.content],
                })

                tool_results = []
                for tool_use in tool_use_blocks:
                    step += 1
                    start = time.time()
                    error = None
                    result_text = ""

                    yield _sse("tool_calling", {
                        "step": step,
                        "tool": tool_use.name,
                        "input": tool_use.input,
                    })

                    try:
                        result = await session.connection.call_tool(
                            tool_use.name, tool_use.input
                        )
                        result_text = _serialize_mcp_result(result)
                    except Exception as e:
                        error = str(e)
                        result_text = f"Error: {error}"

                    duration = time.time() - start

                    tool_step = {
                        "step": step,
                        "tool": tool_use.name,
                        "input": tool_use.input,
                        "output": result_text,
                        "duration": round(duration, 3),
                        "error": error,
                    }
                    tool_chain.append(tool_step)

                    yield _sse("tool_result", tool_step)

                    trace_event = {
                        "step": len(session.traces) + len(trace_events),
                        "timestamp": start,
                        "tool_name": tool_use.name,
                        "tool_input": tool_use.input,
                        "tool_response_chars": len(result_text),
                        "tool_response_tokens_est": max(1, len(result_text) // 4),
                        "tool_response_fields": _extract_fields(result_text),
                        "tool_duration_s": round(duration, 3),
                        "error_category": error if error else None,
                    }
                    trace_events.append(trace_event)

                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": tool_use.id,
                        "content": result_text,
                    })

                messages.append({"role": "user", "content": tool_results})

        except Exception as e:
            final_answer = f"Evaluation error: {e}\n{traceback.format_exc()}"

        eval_result = {
            "prompt": req.prompt,
            "answer": final_answer,
            "toolChain": tool_chain,
            "traceEvents": trace_events,
        }
        session.eval_results.append(eval_result)
        session.traces.extend(trace_events)
        session.prompts.append(req.prompt)

        yield _sse("done", {
            "prompt": req.prompt,
            "answer": final_answer,
            "toolChain": tool_chain,
            "traceEvents": trace_events,
            "index": len(session.eval_results) - 1,
        })

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/optimize/rate")
async def rate(req: RatingRequest):
    if req.prompt_index < 0 or req.prompt_index >= len(session.eval_results):
        raise HTTPException(status_code=400, detail="Invalid prompt index")

    session.eval_results[req.prompt_index]["rating"] = {
        "correctness": req.correctness,
        "notes": req.notes,
    }

    rating_entry = {
        "prompt_index": req.prompt_index,
        "prompt": session.eval_results[req.prompt_index]["prompt"],
        "correctness": req.correctness,
        "notes": req.notes,
    }
    while len(session.ratings) <= req.prompt_index:
        session.ratings.append(None)
    session.ratings[req.prompt_index] = rating_entry

    rated = [r for r in session.ratings if r is not None]
    correct = sum(1 for r in rated if r["correctness"] == "correct")
    partial = sum(1 for r in rated if r["correctness"] == "partial")
    wrong = sum(1 for r in rated if r["correctness"] == "wrong")
    total_scored = correct + partial + wrong
    accuracy = (correct + 0.5 * partial) / total_scored if total_scored > 0 else 0

    return {
        "accuracy": round(accuracy, 3),
        "correct": correct,
        "partial": partial,
        "wrong": wrong,
        "total": len(rated),
    }


@router.post("/optimize/run")
async def run_optimize():
    """Full optimization pipeline with SSE progress streaming.

    Steps: analyze → generate proxy → start proxy → re-run prompts → compare → results
    """
    if not session.connection:
        raise HTTPException(status_code=400, detail="Not connected")

    rated = [r for r in session.ratings if r is not None]
    if not rated:
        raise HTTPException(status_code=400, detail="No rated evaluations yet")

    async def event_stream():
        import asyncio
        import anthropic
        from mcp_optimizer.analyze import run_analysis
        from mcp_optimizer.inventory import analyze_inventory, analysis_to_dict
        from mcp_optimizer.report import compute_comparison

        # --- Step 1: Analyze ---
        yield _sse("progress", {"phase": "analyze", "message": "Analyzing tool usage patterns..."})
        try:
            analysis_result = run_analysis(session.tools, session.traces, rated)
            session.analysis = analysis_result
            session.recommendations = analysis_result.get("recommendations", [])
        except Exception as e:
            yield _sse("error", {"message": f"Analysis failed: {e}"})
            return

        rec_count = len(session.recommendations)
        yield _sse("progress", {"phase": "analyze", "message": f"Found {rec_count} optimization recommendations"})

        if rec_count == 0:
            yield _sse("done", {
                "status": "complete",
                "recommendationCount": 0,
                "comparison": None,
                "message": "No optimizations found",
            })
            return

        # --- Step 2: Generate proxy ---
        yield _sse("progress", {"phase": "proxy", "message": "Generating optimized proxy server..."})
        proxy_code = None
        try:
            proxy_code = _generate_proxy_for_recommendations(
                session.recommendations, session.tools, session.connection.url
            )
            session.proxy_code = proxy_code
        except Exception as e:
            yield _sse("progress", {"phase": "proxy", "message": f"Proxy generation skipped: {e}"})

        # --- Step 3: Start proxy ---
        proxy_port = None
        proxy_process = None
        proxy_tools = None
        proxy_menu_tokens = 0
        if proxy_code:
            yield _sse("progress", {"phase": "proxy", "message": "Starting proxy server..."})
            try:
                proxy_port, proxy_process = _start_proxy(proxy_code)
                await asyncio.sleep(3)  # Give it time to start

                if proxy_process.poll() is not None:
                    stderr = proxy_process.stderr.read().decode() if proxy_process.stderr else ""
                    yield _sse("progress", {"phase": "proxy", "message": f"Proxy failed to start: {stderr[:200]}"})
                    proxy_port = None
                    proxy_process = None
                else:
                    # Get proxy tool list
                    from fastmcp import Client
                    proxy_client = Client(f"http://localhost:{proxy_port}/mcp")
                    async with proxy_client:
                        proxy_tools_list = await proxy_client.list_tools()
                        proxy_tools = len(proxy_tools_list)
                        # Calculate proxy menu tokens
                        proxy_menu_tokens = sum(
                            len(f"{t.name}: {t.description or ''}") // 4 + len(json.dumps(t.inputSchema or {})) // 4
                            for t in proxy_tools_list
                        )
                    yield _sse("progress", {
                        "phase": "proxy",
                        "message": f"Proxy running with {proxy_tools} tools (was {len(session.tools)})"
                    })
            except Exception as e:
                yield _sse("progress", {"phase": "proxy", "message": f"Proxy start failed: {e}"})

        # --- Step 4: Re-run prompts through proxy ---
        proxy_traces = []
        proxy_tool_count = proxy_tools or 0
        if proxy_port and session.api_key:
            yield _sse("progress", {"phase": "evaluate", "message": "Re-running prompts through optimized proxy..."})
            try:
                client = anthropic.Anthropic(api_key=session.api_key)
                from fastmcp import Client as McpClient

                # Build tool list from proxy
                proxy_mcp = McpClient(f"http://localhost:{proxy_port}/mcp")
                async with proxy_mcp:
                    proxy_tools_defs = await proxy_mcp.list_tools()
                    anthropic_tools = [{
                        "name": t.name,
                        "description": t.description or "",
                        "input_schema": t.inputSchema or {"type": "object", "properties": {}},
                    } for t in proxy_tools_defs]

                    for i, eval_result in enumerate(session.eval_results):
                        prompt = eval_result["prompt"]
                        yield _sse("progress", {
                            "phase": "evaluate",
                            "message": f"Re-running prompt {i+1}/{len(session.eval_results)}: {prompt[:50]}..."
                        })

                        # Run the same prompt through the proxy
                        messages = [{"role": "user", "content": prompt}]
                        step = 0
                        try:
                            while True:
                                response = client.messages.create(
                                    model=session.model,
                                    max_tokens=4096,
                                    tools=anthropic_tools,
                                    messages=messages,
                                )

                                tool_use_blocks = [b for b in response.content if b.type == "tool_use"]
                                text_blocks = [b for b in response.content if b.type == "text"]

                                if not tool_use_blocks:
                                    break

                                messages.append({
                                    "role": "assistant",
                                    "content": [_block_to_dict(b) for b in response.content],
                                })

                                tool_results = []
                                for tool_use in tool_use_blocks:
                                    step += 1
                                    start = time.time()
                                    error = None
                                    result_text = ""

                                    try:
                                        result = await proxy_mcp.call_tool(tool_use.name, tool_use.input)
                                        result_text = _serialize_mcp_result(result)
                                    except Exception as e:
                                        error = str(e)
                                        result_text = f"Error: {error}"

                                    duration = time.time() - start

                                    proxy_traces.append({
                                        "step": step,
                                        "timestamp": start,
                                        "tool_name": tool_use.name,
                                        "tool_input": tool_use.input,
                                        "tool_response_chars": len(result_text),
                                        "tool_response_tokens_est": max(1, len(result_text) // 4),
                                        "tool_response_fields": _extract_fields(result_text),
                                        "tool_duration_s": round(duration, 3),
                                        "error_category": error if error else None,
                                    })

                                    tool_results.append({
                                        "type": "tool_result",
                                        "tool_use_id": tool_use.id,
                                        "content": result_text,
                                    })

                                messages.append({"role": "user", "content": tool_results})
                        except Exception as e:
                            yield _sse("progress", {
                                "phase": "evaluate",
                                "message": f"Prompt {i+1} failed: {str(e)[:100]}"
                            })

            except Exception as e:
                yield _sse("progress", {"phase": "evaluate", "message": f"Proxy evaluation failed: {e}"})
        elif not proxy_port:
            yield _sse("progress", {"phase": "evaluate", "message": "Skipping proxy evaluation (no proxy available)"})

        # --- Step 5: Stop proxy ---
        if proxy_process and proxy_process.poll() is None:
            proxy_process.terminate()
            try:
                proxy_process.wait(timeout=5)
            except Exception:
                proxy_process.kill()

        # --- Step 6: Compute comparison ---
        yield _sse("progress", {"phase": "compare", "message": "Computing before/after comparison..."})

        # Use the same ratings for proxy (assume same correctness since same prompts)
        proxy_ratings = rated if proxy_traces else []

        # Build comparison from measured data
        baseline_tokens = sum(t.get("tool_response_tokens_est", 0) for t in session.traces)
        proxy_tokens_total = sum(t.get("tool_response_tokens_est", 0) for t in proxy_traces)
        baseline_calls = len(session.traces)
        proxy_calls = len(proxy_traces)
        baseline_errors = sum(1 for t in session.traces if t.get("error_category"))
        proxy_errors = sum(1 for t in proxy_traces if t.get("error_category"))
        num_prompts = max(len(session.eval_results), 1)

        orig_menu = sum(
            len(f"{t.name}: {t.description or ''}") // 4 + len(json.dumps(t.inputSchema or {})) // 4
            for t in session.tools
        )

        correct_count = sum(1 for r in rated if r["correctness"] == "correct")
        baseline_accuracy = round(correct_count / len(rated), 3) if rated else 0

        baseline = {
            "tool_count": len(session.tools),
            "menu_tokens": orig_menu,
            "avg_tokens_per_prompt": round(baseline_tokens / num_prompts, 1),
            "avg_calls_per_prompt": round(baseline_calls / num_prompts, 1),
            "accuracy": baseline_accuracy,
            "error_rate": round(baseline_errors / max(baseline_calls, 1), 3),
        }

        proxy = {
            "tool_count": proxy_tool_count if proxy_tool_count > 0 else None,
            "menu_tokens": proxy_menu_tokens if proxy_menu_tokens > 0 else None,
            "avg_tokens_per_prompt": round(proxy_tokens_total / num_prompts, 1) if proxy_traces else None,
            "avg_calls_per_prompt": round(proxy_calls / num_prompts, 1) if proxy_traces else None,
            "accuracy": baseline_accuracy if proxy_traces else None,  # Same prompts, assume same correctness
            "error_rate": round(proxy_errors / max(proxy_calls, 1), 3) if proxy_traces else None,
        }

        # Calculate deltas with percentages
        delta = {}
        for key in baseline:
            b = baseline[key]
            p = proxy[key]
            if b is not None and p is not None and isinstance(b, (int, float)) and isinstance(p, (int, float)):
                diff = round(p - b, 3)
                pct = round((p - b) / b * 100, 1) if b != 0 else (0 if p == 0 else None)
                delta[key] = {"value": diff, "pct": pct}

        comparison = {"baseline": baseline, "proxy": proxy, "delta": delta}

        # Warn if accuracy decreased
        if proxy_traces and proxy.get("accuracy") is not None and baseline_accuracy > 0:
            if proxy["accuracy"] < baseline_accuracy:
                comparison["accuracy_warning"] = "Accuracy decreased after optimization — some recommendations may need to be reverted."

        session.comparison = comparison

        yield _sse("progress", {"phase": "complete", "message": "Optimization complete!"})

        yield _sse("done", {
            "status": "complete",
            "recommendationCount": len(session.recommendations),
            "comparison": session.comparison,
            "proxyToolCount": proxy_tool_count,
            "baselineToolCount": len(session.tools),
        })

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def _generate_proxy_for_recommendations(recommendations, tools, upstream_url):
    """Generate proxy code, handling the recommendation format from analyze.py."""
    from mcp_optimizer.inventory import find_name_clusters, tool_token_budget

    # Build a practical proxy: consolidate no-param lookup tools + passthrough rest
    no_param_tools = []
    for t in tools:
        schema = t.inputSchema or {}
        props = schema.get("properties", {})
        required = schema.get("required", [])
        if not props and not required:
            no_param_tools.append(t.name)

    # Generate proxy code directly (simpler than going through proxy_generator)
    lookup_map = {}
    for name in no_param_tools:
        # Strip common prefixes to make table names
        short = name
        for prefix in ["get_", "list_", "fetch_"]:
            if short.startswith(prefix):
                short = short[len(prefix):]
                break
        lookup_map[short] = name

    removed_tools = set()
    # Remove v1/duplicate tools
    tool_names = {t.name for t in tools}
    for t in tools:
        if t.name.endswith("_v1") or t.name == "get_profile_v1":
            removed_tools.add(t.name)

    special_tools = set(no_param_tools) | removed_tools

    # Build proxy code
    lines = [
        '"""Auto-generated MCP proxy server by MCPeriscope."""',
        "",
        "from __future__ import annotations",
        "import argparse",
        "import json",
        "from contextlib import asynccontextmanager",
        "from fastmcp import FastMCP",
        "from mcp_optimizer.proxy_runtime import UpstreamClient",
        "",
        f"UPSTREAM_URL = {json.dumps(upstream_url)}",
        "",
        f"LOOKUP_TOOLS = {json.dumps(lookup_map, indent=2)}",
        "",
        f"REMOVED_TOOLS = {json.dumps(sorted(removed_tools))}",
        "",
        "SPECIAL_TOOLS = set(LOOKUP_TOOLS.values()) | set(REMOVED_TOOLS)",
        "",
        "upstream = UpstreamClient(UPSTREAM_URL)",
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
        "@mcp.tool()",
        "async def lookup(table: str) -> str:",
        '    """Look up reference data by table name. Available tables: ' + ", ".join(sorted(lookup_map.keys())) + '"""',
        "    if table not in LOOKUP_TOOLS:",
        '        return json.dumps({"error": f"Unknown table: {table}. Available: {sorted(LOOKUP_TOOLS.keys())}"})',
        "    result = await upstream.call(LOOKUP_TOOLS[table], {})",
        "    return json.dumps(result) if not isinstance(result, str) else result",
        "",
    ]

    # Generate passthrough tools
    for t in tools:
        if t.name in special_tools:
            continue
        schema = t.inputSchema or {}
        props = schema.get("properties", {})
        required_set = set(schema.get("required", []))
        desc = (t.description or "").replace('"', '\\"').replace("\n", " ")

        # Build params
        params = []
        args_entries = []
        for pname, pschema in props.items():
            ptype = {"string": "str", "integer": "int", "number": "float", "boolean": "bool"}.get(
                pschema.get("type", "string"), "str"
            )
            if pname in required_set:
                params.append(f"{pname}: {ptype}")
            else:
                params.append(f"{pname}: {ptype} | None = None")
            args_entries.append(f'"{pname}": {pname}')

        param_str = ", ".join(params)
        args_str = "{" + ", ".join(args_entries) + "}" if args_entries else "{}"

        lines.append(f'@mcp.tool(description="{desc[:500]}")')
        lines.append(f"async def {t.name}({param_str}) -> str:")
        lines.append(f"    args = {{k: v for k, v in {args_str}.items() if v is not None}}")
        lines.append(f'    result = await upstream.call("{t.name}", args)')
        lines.append(f"    return json.dumps(result) if not isinstance(result, str) else result")
        lines.append("")

    # Entry point
    lines.extend([
        'if __name__ == "__main__":',
        '    parser = argparse.ArgumentParser()',
        '    parser.add_argument("--port", type=int, default=8000)',
        '    args = parser.parse_args()',
        '    mcp.run(transport="streamable-http", port=args.port)',
    ])

    code = "\n".join(lines)

    # Save to file
    proxy_dir = session.project_dir / "proxy"
    proxy_dir.mkdir(parents=True, exist_ok=True)
    (proxy_dir / "server.py").write_text(code)

    return code


def _start_proxy(proxy_code: str) -> tuple[int, subprocess.Popen]:
    """Start the proxy server on a random port. Returns (port, process)."""
    # Find available port
    with socket.socket() as s:
        s.bind(("", 0))
        port = s.getsockname()[1]

    proxy_file = session.project_dir / "proxy" / "server.py"

    process = subprocess.Popen(
        [sys.executable, str(proxy_file), "--port", str(port)],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    return port, process


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


def _block_to_dict(block) -> dict:
    if block.type == "text":
        return {"type": "text", "text": block.text}
    elif block.type == "tool_use":
        return {"type": "tool_use", "id": block.id, "name": block.name, "input": block.input}
    else:
        return {"type": block.type}
