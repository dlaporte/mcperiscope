from __future__ import annotations
from typing import Any, Literal
from pydantic import BaseModel, Field, field_validator


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
    custom_context_window: int | None = None


class ToolCallRequest(BaseModel):
    name: str
    arguments: dict[str, Any] = {}


class ResourceReadRequest(BaseModel):
    uri: str


class PromptGetRequest(BaseModel):
    name: str
    arguments: dict[str, str] = {}


class EvaluateRequest(BaseModel):
    prompt: str = Field(..., min_length=1)
    api_key: str | None = None
    model: str | None = None
    provider: str | None = None
    custom_endpoint: str | None = None
    max_tool_rounds: int | None = None
    max_tokens: int | None = None

    @field_validator('max_tokens')
    @classmethod
    def validate_max_tokens(cls, v):
        if v is not None and not (1 <= v <= 100000):
            raise ValueError('max_tokens must be between 1 and 100000')
        return v

    @field_validator('max_tool_rounds')
    @classmethod
    def validate_max_tool_rounds(cls, v):
        if v is not None and not (1 <= v <= 100):
            raise ValueError('max_tool_rounds must be between 1 and 100')
        return v


class RatingRequest(BaseModel):
    prompt_index: int
    correctness: Literal["correct", "partial", "wrong", "skipped"]
    notes: str = ""


class OAuthCallbackRequest(BaseModel):
    callback_url: str
    model: str | None = None
    api_key: str | None = None
