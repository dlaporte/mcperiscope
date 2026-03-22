"""Runtime support for generated MCP proxy servers."""

from __future__ import annotations

import json
from typing import Any

from fastmcp import Client
from fastmcp.client.auth import BearerAuth


class UpstreamClient:
    """Connects to the original MCP server and forwards tool calls."""

    def __init__(self, url: str, token_dir: str | None = None):
        self.url = url
        self._token_dir = token_dir
        self._client: Client | None = None

    async def connect(self):
        """Connect to the upstream MCP server."""
        # Reuse existing OAuth tokens from mcp-optimizer's token store
        from backend.mcp_optimizer.token_store import FileKeyValueStore
        from fastmcp.client.auth import OAuth
        from pathlib import Path

        token_dir = Path(self._token_dir) if self._token_dir else Path.home() / ".mcp-optimizer" / "tokens"
        store = FileKeyValueStore(token_dir)
        auth = OAuth(client_name="mcp-optimizer", token_storage=store)
        self._client = Client(self.url, auth=auth)
        await self._client.__aenter__()

    async def disconnect(self):
        if self._client:
            await self._client.__aexit__(None, None, None)
            self._client = None

    async def call(self, tool_name: str, arguments: dict[str, Any]) -> Any:
        """Call a tool on the upstream server and return the result."""
        if not self._client:
            raise RuntimeError("Not connected to upstream")
        # Strip None values — upstream may reject them for typed params
        clean_args = {k: v for k, v in arguments.items() if v is not None}
        result = await self._client.call_tool(tool_name, clean_args)
        # Parse the result text
        if hasattr(result, 'content'):
            texts = []
            for block in result.content:
                if hasattr(block, 'text'):
                    texts.append(block.text)
            text = "\n".join(texts) if texts else str(result)
        else:
            text = str(result)
        # Try to parse as JSON
        try:
            return json.loads(text)
        except (json.JSONDecodeError, TypeError):
            return text


class FieldFilter:
    """Filter response fields for trimmed tools."""

    @staticmethod
    def keep_fields(data: Any, fields: list[str]) -> Any:
        """Keep only specified fields from a dict or list of dicts."""
        if isinstance(data, dict):
            return {k: v for k, v in data.items() if k in fields}
        elif isinstance(data, list):
            return [FieldFilter.keep_fields(item, fields) for item in data]
        return data

    @staticmethod
    def drop_fields(data: Any, fields: list[str]) -> Any:
        """Drop specified fields from a dict or list of dicts."""
        if isinstance(data, dict):
            return {k: v for k, v in data.items() if k not in fields}
        elif isinstance(data, list):
            return [FieldFilter.drop_fields(item, fields) for item in data]
        return data


class Dispatcher:
    """Route consolidated tool calls to the correct upstream tool."""

    def __init__(self, upstream: UpstreamClient, tool_map: dict[str, str]):
        """
        Args:
            upstream: The upstream client
            tool_map: Maps parameter value -> upstream tool name
                e.g. {"rank": "lookup_rank", "status": "lookup_status"}
        """
        self.upstream = upstream
        self.tool_map = tool_map

    async def dispatch(self, key: str, arguments: dict[str, Any]) -> Any:
        """Dispatch to the correct upstream tool based on key."""
        tool_name = self.tool_map.get(key)
        if not tool_name:
            raise ValueError(f"Unknown dispatch key: {key}. Valid: {list(self.tool_map.keys())}")
        return await self.upstream.call(tool_name, arguments)
