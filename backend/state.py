from __future__ import annotations
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from mcp_optimizer.connections import MCPConnection


MODEL_CONTEXT_WINDOWS = {
    "claude-sonnet-4-20250514": 200_000,
    "claude-opus-4-20250514": 200_000,
    "claude-haiku-4-5-20251001": 200_000,
    "gpt-4o": 128_000,
    "gpt-4-turbo": 128_000,
    "gpt-4": 8_192,
    "gpt-3.5-turbo": 16_384,
}


@dataclass
class Session:
    connection: MCPConnection | None = None
    tools: list[Any] = field(default_factory=list)
    inventory: dict | None = None
    traces: list[dict] = field(default_factory=list)
    ratings: list[dict] = field(default_factory=list)
    analysis: dict | None = None
    recommendations: list[dict] = field(default_factory=list)
    prompts: list[str] = field(default_factory=list)
    model: str = "claude-sonnet-4-20250514"
    api_key: str = ""
    eval_results: list[dict] = field(default_factory=list)
    comparison: dict | None = None
    proxy_code: str | None = None
    project_dir: Path = field(default_factory=lambda: Path.home() / ".mcperiscope" / "projects" / "default")

    def reset(self):
        """Reset all state except connection config."""
        self.tools = []
        self.inventory = None
        self.traces = []
        self.ratings = []
        self.analysis = None
        self.recommendations = []
        self.prompts = []
        self.eval_results = []
        self.comparison = None
        self.proxy_code = None


session = Session()
