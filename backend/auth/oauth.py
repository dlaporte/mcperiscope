"""OAuth support for mcperiscope.

The actual OAuth flow is handled by mcp-optimizer's HeadlessOAuth class
via MCPConnection.connect_with_auth_url() and supply_callback_url().

For web contexts, the flow is:
1. connect_with_auth_url() returns an auth URL
2. Frontend redirects browser to that URL
3. User authenticates
4. Browser redirects back to mcperiscope with code in URL
5. Frontend sends code to /api/auth/callback
6. Backend calls supply_callback_url() with the full callback URL
"""
