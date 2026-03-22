"""Web-native OAuth for mcperiscope.

Subclasses mcp-optimizer's HeadlessOAuth to use the mcperiscope frontend
URL as the OAuth redirect URI instead of a localhost callback server.
"""

from __future__ import annotations

import os
import logging

from backend.mcp_optimizer.connections import HeadlessOAuth
from backend.mcp_optimizer.token_store import FileKeyValueStore
from pathlib import Path

logger = logging.getLogger(__name__)


class WebOAuth(HeadlessOAuth):
    """HeadlessOAuth that redirects to the mcperiscope frontend."""

    def __init__(self, redirect_url: str, **kwargs):
        self._web_redirect_url = redirect_url
        super().__init__(**kwargs)

    def _bind(self, mcp_url: str) -> None:
        """Override binding to use the web redirect URL instead of localhost."""
        if self._bound:
            return

        from pydantic import AnyHttpUrl
        from mcp.shared.auth import OAuthClientMetadata

        mcp_url = mcp_url.rstrip("/")

        scopes_str = ""
        if isinstance(self._scopes, list):
            scopes_str = " ".join(self._scopes)
        elif self._scopes is not None:
            scopes_str = str(self._scopes)

        client_metadata = OAuthClientMetadata(
            client_name=self._client_name,
            redirect_uris=[AnyHttpUrl(self._web_redirect_url)],
            grant_types=["authorization_code", "refresh_token"],
            response_types=["code"],
            scope=scopes_str,
            **(self._additional_client_metadata or {}),
        )

        from fastmcp.client.auth.oauth import TokenStorageAdapter
        from key_value.aio.stores.memory import MemoryStore

        token_storage = self._token_storage or MemoryStore()

        self.token_storage_adapter = TokenStorageAdapter(
            async_key_value=token_storage, server_url=mcp_url
        )

        self.mcp_url = mcp_url

        # Use the redirect_url for the callback, not localhost
        self.redirect_port = 0  # Not used

        from mcp.client.auth import OAuthClientProvider
        OAuthClientProvider.__init__(
            self,
            server_url=mcp_url,
            client_metadata=client_metadata,
            storage=self.token_storage_adapter,
            redirect_handler=self.redirect_handler,
            callback_handler=self.callback_handler,
        )

        self._bound = True
