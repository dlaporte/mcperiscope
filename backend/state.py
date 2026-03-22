from __future__ import annotations
import time
from dataclasses import dataclass, field
from pathlib import Path
from subprocess import Popen
from typing import Any

from backend.mcp_optimizer.connections import MCPConnection


MODEL_CONTEXT_WINDOWS = {
    # Anthropic — Claude 4.6
    "claude-opus-4-6": 1_000_000,
    "claude-sonnet-4-6": 1_000_000,
    # Anthropic — Claude 4.5
    "claude-haiku-4-5-20251001": 200_000,
    # OpenAI — GPT-5.x
    "gpt-5.4": 1_000_000,
    "gpt-5.4-mini": 400_000,
    "gpt-5.2": 400_000,
    # OpenAI — GPT-4o
    "gpt-4o": 128_000,
    "gpt-4o-mini": 128_000,
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
    model: str = "claude-sonnet-4-6"
    provider: str = "anthropic"
    api_key: str = ""
    custom_endpoint: str = ""
    custom_context_window: int = 128_000
    analyst_model: str = ""
    analyst_provider: str = ""
    analyst_api_key: str = ""
    analyst_endpoint: str = ""
    loaded_resources: dict[str, dict] = field(default_factory=dict)  # uri → {name, content, tokens}
    eval_results: list[dict] = field(default_factory=list)
    comparison: dict | None = None
    proxy_code: str | None = None
    proxy_process: Popen | None = None
    quick_wins: list[dict] = field(default_factory=list)
    project_dir: Path = field(default_factory=lambda: Path.home() / ".mcperiscope" / "projects" / "default")

    def kill_proxy(self):
        """Terminate any running proxy process."""
        if self.proxy_process and self.proxy_process.poll() is None:
            self.proxy_process.terminate()
            try:
                self.proxy_process.wait(timeout=5)
            except Exception:
                self.proxy_process.kill()
        self.proxy_process = None

    def reset(self):
        """Reset all state except connection config."""
        self.kill_proxy()
        self.tools = []
        self.inventory = None
        self.traces = []
        self.ratings = []
        self.analysis = None
        self.recommendations = []
        self.prompts = []
        self.loaded_resources = {}
        self.eval_results = []
        self.comparison = None
        self.proxy_code = None
        self.quick_wins = []


session = Session()
