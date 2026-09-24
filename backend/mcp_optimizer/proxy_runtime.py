"""Runtime support for generated MCP proxy servers."""

from __future__ import annotations

import json
from typing import Any

import httpx
from fastmcp import Client


class StaticHeaderAuth(httpx.Auth):
    """Inject a fixed header on every request — used for bearer/custom-header MCP auth."""

    def __init__(self, header_name: str, header_value: str) -> None:
        self._header_name = header_name
        self._header_value = header_value

    def auth_flow(self, request):
        request.headers[self._header_name] = self._header_value
        yield request


class UpstreamClient:
    """Connects to the original MCP server and forwards tool calls."""

    def __init__(
        self,
        url: str,
        token_dir: str | None = None,
        auth_config: dict | None = None,
        client_name: str = "MCPeriscope",
    ):
        self.url = url
        self._token_dir = token_dir
        self._auth_config = auth_config or {}
        self._client_name = client_name
        self._client: Client | None = None

    def _build_auth(self):
        auth_type = (self._auth_config.get("type") or "oauth").lower()
        if auth_type == "none":
            return None
        if auth_type == "bearer":
            return StaticHeaderAuth(
                "Authorization", f"Bearer {self._auth_config.get('token') or ''}"
            )
        if auth_type == "header":
            return StaticHeaderAuth(
                self._auth_config.get("name") or "",
                self._auth_config.get("value") or "",
            )
        if auth_type == "oauth_client_creds":
            from backend.auth.client_credentials import ClientCredentialsAuth

            return ClientCredentialsAuth(
                token_endpoint=self._auth_config.get("token_endpoint") or "",
                client_id=self._auth_config.get("client_id") or "",
                client_secret=self._auth_config.get("client_secret") or "",
                scope=self._auth_config.get("scope"),
                client_auth=self._auth_config.get("client_auth") or "post",
            )
        # oauth (default): reuse existing OAuth tokens from the token store
        from backend.mcp_optimizer.token_store import FileKeyValueStore
        from fastmcp.client.auth import OAuth
        from pathlib import Path

        token_dir = (
            Path(self._token_dir)
            if self._token_dir
            else Path.home() / ".mcperiscope" / "tokens"
        )
        store = FileKeyValueStore(token_dir)
        return OAuth(client_name=self._client_name, token_storage=store)

    async def connect(self):
        """Connect to the upstream MCP server."""
        self._client = Client(self.url, auth=self._build_auth())
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
