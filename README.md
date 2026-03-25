# MCPeriscope

A web-based tool for exploring, evaluating, and optimizing [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) servers. MCPeriscope helps you understand how your MCP server consumes LLM context and generates optimized proxy configurations to reduce token usage.

## What it does

### Explore MCP capabilities

Connect to any MCP server and browse its tools, resource definitions, and prompts. Each item shows its estimated token cost so you can see where context budget is being spent. Sort by name or token count, filter by keyword, and inspect schemas, descriptions, and resource content with inline markdown rendering.

### Monitor context usage

Track how much of the LLM's context window is consumed by tool definitions, loaded resources, and evaluation prompts. A real-time session usage gauge shows context growth during tool-calling conversations, updated with actual API-reported token counts. The gauge is consistent across all tabs.

### Evaluate with real prompts

Run natural language prompts against your MCP server and watch the LLM chain tool calls in real time with streaming responses. Use single or batch mode to evaluate multiple prompts at once. Load MCP resources into the evaluation context to test how they affect tool selection and response quality.

### Optimize with a generated proxy

MCPeriscope analyzes tool usage patterns from your evaluation prompts and generates discrete, actionable recommendations grouped by source:

**Behavior recommendations** (from trace analysis):
- **Consolidate** — merge tools that share a common prefix into a single dispatch tool
- **Rewrite descriptions** — improve tool descriptions for better LLM selection
- **Trim responses** — reduce verbose tool response data
- **Batch** — add batch parameters to reduce round-trips
- **Add defaults** — add default values to reduce required parameters

**Inventory recommendations** (from static analysis):
- **Trim descriptions** — rewrite verbose tool descriptions more concisely
- **Remove unused tools** — omit tools never called during evaluation
- **Consolidate lookups** — merge no-parameter tools into a single `lookup(table)` tool
- **Condense resources** — use the analyst LLM to shorten markdown resource content

Select which recommendations to apply, click Optimize, and MCPeriscope assembles a purpose-built MCP proxy server (using [FastMCP](https://github.com/jlowin/fastmcp)) from modular code templates. Proxy generation is near-instant and deterministic — the LLM is only used for description rewriting (one batched call) and resource condensing. The proxy is then started and your evaluation prompts are re-run through it to show a before/after comparison of context usage, tool counts, accuracy, and latency.

Run multiple optimization passes with different recommendation combinations and compare results using the run selector dropdown.

## Architecture

- **Backend**: Python / FastAPI with SSE streaming for real-time progress
- **Frontend**: React / TypeScript / Vite / Tailwind CSS / Zustand
- **LLM Support**: Anthropic (Claude), OpenAI, and any OpenAI-compatible endpoint
- **MCP Connectivity**: OAuth 2.0, bearer token, and custom header authentication
- **Proxy Generation**: Modular code templates with compile-time validation

## Getting started

### Prerequisites

- Python 3.11+
- Node.js 18+
- [uv](https://docs.astral.sh/uv/) (recommended) or pip

### Install and run

```bash
git clone https://github.com/dlaporte/mcperiscope.git
cd mcperiscope
./dev.sh
```

`dev.sh` installs Python and Node dependencies automatically, then starts the backend on port 8000 and frontend on port 5173.

### Configure

1. Open http://localhost:5173
2. Go to **Settings** and configure your LLMs — each with its own provider, model, API key, and endpoint
3. Add your MCP server configurations with URL and authentication method
4. Assign LLMs to roles:
   - **Agent** — executes evaluation prompts using MCP tools to answer questions
   - **Analyst** — compares baseline vs optimized answers and rewrites tool descriptions

### Workflow

1. **Connect** — select your MCP server and click Connect
2. **Explore** — browse tools, resource definitions, and prompts with token costs
3. **Evaluate** — run test prompts (single or batch) and watch tool calls stream in real time
4. **Optimize** — review recommendations, select which to apply, click Optimize, and compare results

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CORS_ORIGINS` | `http://localhost:5173` | Comma-separated allowed origins |
| `OAUTH_REDIRECT_URL` | Auto-detected | OAuth callback URL override |

## License

MIT
