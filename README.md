# MCPeriscope

A web-based tool for exploring, evaluating, and optimizing [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) servers. MCPeriscope helps you understand how your MCP server consumes LLM context and generates optimized proxy configurations to reduce token usage.

## What it does

### Explore MCP capabilities

Connect to any MCP server and browse its tools, resources, and prompts. Each item shows its estimated token cost so you can see where context budget is being spent. Sort by name or token count, filter by keyword, and inspect schemas, descriptions, and resource content.

### Monitor context usage

Track how much of the LLM's context window is consumed by tool definitions, loaded resources, and evaluation prompts. A real-time session usage gauge shows context growth during tool-calling conversations, updated with actual API-reported token counts.

### Optimize with a generated proxy

MCPeriscope analyzes tool usage patterns from your evaluation prompts and generates discrete, actionable recommendations:

- **Trim descriptions** — rewrite verbose tool descriptions more concisely
- **Remove unused tools** — omit tools never called during evaluation
- **Consolidate lookups** — merge no-parameter tools into a single `lookup(table)` tool
- **Condense resources** — use an analyst LLM to shorten markdown resource content

Select which recommendations to apply, click Optimize, and MCPeriscope generates a purpose-built MCP proxy server (using [FastMCP](https://github.com/jlowin/fastmcp)) that sits between the LLM and your upstream server. It then re-runs your evaluation prompts through the proxy and shows a before/after comparison of context usage, tool counts, accuracy, and latency.

Run multiple optimization passes with different recommendation combinations and compare results.

## Architecture

- **Backend**: Python / FastAPI with SSE streaming for real-time progress
- **Frontend**: React / TypeScript / Vite / Tailwind CSS / Zustand
- **LLM Support**: Anthropic (Claude), OpenAI, and any OpenAI-compatible endpoint
- **MCP Connectivity**: OAuth 2.0, bearer token, and custom header authentication

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
2. Go to **Settings** and add your LLM configurations (API keys, models, endpoints)
3. Add your MCP server (URL and authentication method)
4. Assign LLMs to the **Agent** role (runs evaluation prompts) and **Analyst** role (compares answers and generates proxy code)

### Connect and explore

1. Go to **Connect**, select your MCP server, and click Connect
2. Switch to **Explore** to browse tools, resources, and prompts with token costs
3. Switch to **Evaluate** to run test prompts and watch the LLM chain tool calls in real time
4. Switch to **Optimize** to see recommendations, select optimizations, and generate a proxy

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CORS_ORIGINS` | `http://localhost:5173` | Comma-separated allowed origins |
| `OAUTH_REDIRECT_URL` | Auto-detected | OAuth callback URL override |

## License

MIT
