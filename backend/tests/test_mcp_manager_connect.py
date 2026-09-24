"""Background connect-task lifecycle in mcp_manager."""

from __future__ import annotations

import asyncio

import pytest

from backend import mcp_manager

CALLBACK = "http://localhost:5173/oauth/callback?code=c&state=s"


class _FakeOAuth:
    def __init__(self, *args, **kwargs):
        self.pending_auth_url = "https://auth.example/authorize"
        self.callback = asyncio.Event()

    def supply_callback_url(self, url):
        self.callback.set()


class _FakeClient:
    """Blocks in __aenter__ until the OAuth callback arrives, then fails."""

    def __init__(self, auth):
        self.auth = auth
        self.exited = False

    async def __aenter__(self):
        await self.auth.callback.wait()
        raise RuntimeError("upstream exploded")

    async def __aexit__(self, *exc):
        self.exited = True


@pytest.fixture
def fake_mcp(monkeypatch):
    monkeypatch.setattr(mcp_manager, "WebOAuth", _FakeOAuth)
    monkeypatch.setattr(
        mcp_manager, "_build_client", lambda url, auth, cfg, protocol=None: _FakeClient(auth)
    )


def test_complete_oauth_surfaces_real_connect_error(fake_mcp):
    async def run():
        result = await mcp_manager.connect("https://srv.example/mcp")
        assert result["status"] == "oauth_redirect"
        with pytest.raises(RuntimeError, match="upstream exploded"):
            await mcp_manager.complete_oauth(CALLBACK)
        await mcp_manager.disconnect()

    asyncio.run(asyncio.wait_for(run(), timeout=5))


def test_disconnect_cancels_pending_connect(fake_mcp):
    async def run():
        await mcp_manager.connect("https://srv.example/mcp")
        task = mcp_manager._connect_task
        assert task is not None and not task.done()
        await mcp_manager.disconnect()
        assert task.cancelled()
        assert mcp_manager._connect_task is None

    asyncio.run(asyncio.wait_for(run(), timeout=5))
