"""Web-native OAuth for mcperiscope.

Subclasses mcp-optimizer's HeadlessOAuth to use the mcperiscope frontend
URL as the OAuth redirect URI instead of a localhost callback server.
"""

from __future__ import annotations

import logging

from backend.mcp_optimizer.connections import HeadlessOAuth

logger = logging.getLogger(__name__)


class WebOAuth(HeadlessOAuth):
    """HeadlessOAuth that redirects to the mcperiscope frontend."""

    def __init__(self, redirect_url: str, **kwargs):
        self._web_redirect_url = redirect_url
        super().__init__(**kwargs)

    def _bind(self, mcp_url: str) -> None:
        """Override binding to use the web redirect URL instead of localhost.

        Mirrors fastmcp's OAuth._bind (which builds a localhost redirect and a
        static client info when client_id is pre-registered) so that the
        scopes / client_id / client_secret / client_metadata_url options keep
        working with the web redirect substituted.
        """
        if self._bound:
            return

        from pydantic import AnyHttpUrl
        from mcp.client.auth import OAuthClientProvider
        from mcp.shared.auth import OAuthClientInformationFull, OAuthClientMetadata
        from fastmcp.client.auth.oauth import TokenStorageAdapter
        from key_value.aio.stores.memory import MemoryStore

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

        if self._client_id:
            # Pre-registered client: build the full static client info directly,
            # which skips dynamic client registration (consumed by _initialize).
            metadata = client_metadata.model_dump(exclude_none=True)
            if "token_endpoint_auth_method" not in metadata:
                metadata["token_endpoint_auth_method"] = (
                    "client_secret_post" if self._client_secret else "none"
                )
            self._static_client_info = OAuthClientInformationFull(
                client_id=self._client_id,
                client_secret=self._client_secret,
                **metadata,
            )

        token_storage = self._token_storage or MemoryStore()

        self.token_storage_adapter = TokenStorageAdapter(
            async_key_value=token_storage, server_url=mcp_url
        )

        self.mcp_url = mcp_url

        # Use the redirect_url for the callback, not localhost
        self.redirect_port = 0  # Not used

        OAuthClientProvider.__init__(
            self,
            server_url=mcp_url,
            client_metadata=client_metadata,
            storage=self.token_storage_adapter,
            redirect_handler=self.redirect_handler,
            callback_handler=self.callback_handler,
            client_metadata_url=self._client_metadata_url,
        )

        self._bound = True
