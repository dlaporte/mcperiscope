"""Regression tests for the credential binder (security-critical)."""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from backend.credentials import bind_primary_credentials


class _State:
    # Minimal in-memory stand-in for `session` (which is a dataclass instance
    # at runtime). Mirrors the fields that bind_primary_credentials touches.
    def __init__(self, **kwargs):
        self.model = ""
        self.provider = ""
        self.api_key = ""
        self.custom_endpoint = ""
        self.api_key_provider = ""
        self.api_key_endpoint = ""
        for k, v in kwargs.items():
            setattr(self, k, v)


def test_initial_bind_with_key():
    s = _State()
    bind_primary_credentials(
        s, api_key="sk-1", provider="anthropic", custom_endpoint=None, model="claude-x"
    )
    assert s.api_key == "sk-1"
    assert s.provider == "anthropic"
    assert s.custom_endpoint == ""
    assert s.api_key_provider == "anthropic"
    assert s.api_key_endpoint == ""
    assert s.model == "claude-x"


def test_idempotent_call_preserves_stored_key():
    """Caller sends nothing — stored credentials must not be wiped."""
    s = _State(
        api_key="sk-1",
        provider="openai",
        custom_endpoint="https://api.example.com/v1",
        api_key_provider="openai",
        api_key_endpoint="https://api.example.com/v1",
    )
    bind_primary_credentials(s, api_key=None, provider=None, custom_endpoint=None, model=None)
    assert s.api_key == "sk-1"
    assert s.custom_endpoint == "https://api.example.com/v1"


def test_caller_omits_endpoint_does_not_clear_it():
    """Frontend sends api_key + provider but omits custom_endpoint.

    Common shape when re-binding the same custom OpenAI key. The stored
    endpoint must be preserved when the field is `None`, otherwise a real
    user's evaluations would silently hit api.openai.com after a
    no-op rebind.
    """
    s = _State(
        api_key="sk-1",
        provider="custom",
        custom_endpoint="https://api.example.com/v1",
        api_key_provider="custom",
        api_key_endpoint="https://api.example.com/v1",
    )
    bind_primary_credentials(s, api_key=None, provider="custom", custom_endpoint=None, model=None)
    assert s.api_key == "sk-1"
    assert s.custom_endpoint == "https://api.example.com/v1"


def test_destination_change_without_key_rejected_and_wipes():
    s = _State(
        api_key="sk-1",
        provider="anthropic",
        custom_endpoint="",
        api_key_provider="anthropic",
        api_key_endpoint="",
    )
    with pytest.raises(HTTPException) as excinfo:
        bind_primary_credentials(
            s,
            api_key=None,
            provider="custom",
            custom_endpoint="https://evil.example/v1",
            model=None,
        )
    assert excinfo.value.status_code == 400
    # Key was wiped — caller must resubmit.
    assert s.api_key == ""
    assert s.api_key_provider == ""
    assert s.api_key_endpoint == ""


def test_resubmitting_key_with_new_destination_succeeds():
    s = _State(
        api_key="sk-old",
        provider="anthropic",
        custom_endpoint="",
        api_key_provider="anthropic",
        api_key_endpoint="",
    )
    bind_primary_credentials(
        s,
        api_key="sk-new",
        provider="custom",
        custom_endpoint="https://api.example.com/v1",
        model=None,
    )
    assert s.api_key == "sk-new"
    assert s.provider == "custom"
    assert s.custom_endpoint == "https://api.example.com/v1"
    assert s.api_key_provider == "custom"
    assert s.api_key_endpoint == "https://api.example.com/v1"


def test_explicit_empty_endpoint_clears_it():
    """`""` is "explicit clear"; distinct from `None` which means "no change"."""
    s = _State(
        api_key="sk-1",
        provider="custom",
        custom_endpoint="https://api.example.com/v1",
        api_key_provider="custom",
        api_key_endpoint="https://api.example.com/v1",
    )
    # Caller explicitly sets endpoint to "" along with a new key — fine.
    bind_primary_credentials(
        s, api_key="sk-2", provider="anthropic", custom_endpoint="", model=None
    )
    assert s.api_key == "sk-2"
    assert s.custom_endpoint == ""
    assert s.api_key_endpoint == ""


def test_first_time_no_state_no_raise():
    """No stored key yet — caller can change provider/endpoint freely."""
    s = _State()
    bind_primary_credentials(
        s, api_key=None, provider="openai", custom_endpoint="https://x/v1", model=None
    )
    assert s.api_key == ""
    assert s.provider == "openai"
    assert s.custom_endpoint == "https://x/v1"
