"""Shared test helpers: a tool factory and a per-test clean session."""

from __future__ import annotations

import dataclasses
from types import SimpleNamespace

import pytest

from backend.state import Session, session


def make_tool(
    name: str,
    properties: dict | None = None,
    required: list[str] | None = None,
    description: str = "d",
) -> SimpleNamespace:
    """A stand-in for an mcp.types.Tool with an object input schema."""
    return SimpleNamespace(
        name=name,
        description=description,
        inputSchema={
            "type": "object",
            "properties": properties or {},
            "required": required or [],
        },
    )


@pytest.fixture
def tool_factory():
    return make_tool


@pytest.fixture
def clean_session(monkeypatch):
    """Reset every Session field on the shared `session` to its default.

    Field-level (not a new Session) because modules hold the object itself
    via `from backend.state import session`; monkeypatch restores it after.
    """
    for f in dataclasses.fields(Session):
        if f.default_factory is not dataclasses.MISSING:
            value = f.default_factory()
        else:
            value = f.default
        monkeypatch.setattr(session, f.name, value)
    return session
