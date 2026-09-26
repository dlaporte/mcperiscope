"""The frontend's known-model list must match the backend's context windows."""

from __future__ import annotations

import re
from pathlib import Path

from backend.state import MODEL_CONTEXT_WINDOWS

_MODELS_TS = Path(__file__).resolve().parents[2] / "frontend" / "src" / "config" / "models.ts"


def test_frontend_models_match_backend_context_windows():
    text = _MODELS_TS.read_text()
    entries = re.findall(r'\{\s*id:\s*"([^"]+)"[^}]*?\bcontext:\s*(\d+)', text)
    assert entries, "no models parsed from models.ts"
    assert dict((model_id, int(ctx)) for model_id, ctx in entries) == MODEL_CONTEXT_WINDOWS
    assert len(entries) == len(MODEL_CONTEXT_WINDOWS)  # no duplicate ids
