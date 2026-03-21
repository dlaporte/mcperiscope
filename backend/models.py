from __future__ import annotations
from typing import Any, Literal
from pydantic import BaseModel


class AuthConfig(BaseModel):
    type: Literal["none", "bearer", "header", "oauth"] = "none"
    token: str | None = None
    name: str | None = None
    value: str | None = None


class ConnectRequest(BaseModel):
    url: str
    auth: AuthConfig | None = None
    model: str | None = None
    api_key: str | None = None


class ToolCallRequest(BaseModel):
    name: str
    arguments: dict[str, Any] = {}


class ResourceReadRequest(BaseModel):
    uri: str


class PromptGetRequest(BaseModel):
    name: str
    arguments: dict[str, str] = {}


class EvaluateRequest(BaseModel):
    prompt: str
    api_key: str | None = None
    model: str | None = None


class RatingRequest(BaseModel):
    prompt_index: int
    correctness: Literal["correct", "partial", "wrong", "skipped"]
    notes: str = ""


class OAuthCallbackRequest(BaseModel):
    callback_url: str
    model: str | None = None
    api_key: str | None = None
