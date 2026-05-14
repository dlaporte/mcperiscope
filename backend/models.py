from __future__ import annotations
from typing import Any, Literal
from pydantic import BaseModel, Field


# Hard upper bounds for user-supplied values. Keeps a malicious or buggy caller
# from running away with the LLM cost / latency budget.
MAX_TOOL_ROUNDS = 50
MAX_TOKENS_PER_RESPONSE = 32_000
MAX_PROMPT_CHARS = 64_000


class AuthConfig(BaseModel):
    type: Literal["none", "bearer", "header", "oauth"] = "none"
    token: str | None = None
    name: str | None = None
    value: str | None = None


class ConnectRequest(BaseModel):
    url: str
    auth: AuthConfig | None = None
    model: str | None = None
    provider: str | None = None
    api_key: str | None = None
    custom_endpoint: str | None = None
    custom_context_window: int | None = Field(default=None, ge=1, le=2_000_000)


class ToolCallRequest(BaseModel):
    name: str
    arguments: dict[str, Any] = {}


class ResourceReadRequest(BaseModel):
    uri: str


class PromptGetRequest(BaseModel):
    name: str
    arguments: dict[str, str] = {}


class EvaluateRequest(BaseModel):
    prompt: str = Field(max_length=MAX_PROMPT_CHARS)
    api_key: str | None = None
    model: str | None = None
    provider: str | None = None
    custom_endpoint: str | None = None
    max_tool_rounds: int | None = Field(default=None, ge=1, le=MAX_TOOL_ROUNDS)
    max_tokens: int | None = Field(default=None, ge=1, le=MAX_TOKENS_PER_RESPONSE)


class RatingRequest(BaseModel):
    prompt_index: int
    correctness: Literal["correct", "partial", "wrong", "skipped"]
    notes: str = ""


class OAuthCallbackRequest(BaseModel):
    callback_url: str
    model: str | None = None
    api_key: str | None = None
