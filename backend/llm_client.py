"""Unified LLM client abstraction for Anthropic and OpenAI-compatible APIs.

Provides a common interface for the agentic tool-calling loop regardless
of which LLM provider is being used. Uses async clients with streaming support.
"""

from __future__ import annotations

import json
from collections.abc import AsyncGenerator
from dataclasses import dataclass, field
from typing import Any


@dataclass
class ToolCall:
    id: str
    name: str
    input: dict[str, Any]


@dataclass
class LLMResponse:
    tool_calls: list[ToolCall] = field(default_factory=list)
    text: str = ""
    input_tokens: int = 0
    output_tokens: int = 0
    raw: Any = None


OPENAI_MODEL_PREFIXES = ("gpt-", "o1-", "o3-", "o4-")


class LLMClient:
    """Unified async interface for calling LLMs with tool and streaming support."""

    def __init__(self, api_key: str, model: str, custom_endpoint: str = ""):
        self.model = model
        is_openai_model = any(model.startswith(p) for p in OPENAI_MODEL_PREFIXES)
        self._is_openai = bool(custom_endpoint) or is_openai_model

        if self._is_openai:
            from openai import AsyncOpenAI
            base_url = custom_endpoint if custom_endpoint else None
            self._openai = AsyncOpenAI(api_key=api_key, base_url=base_url)
            self._anthropic = None
        else:
            import anthropic
            self._anthropic = anthropic.AsyncAnthropic(api_key=api_key)
            self._openai = None

    async def chat(self, messages: list[dict], tools: list[dict] | None = None, max_tokens: int = 4096) -> LLMResponse:
        """Non-streaming chat. Returns complete response."""
        if not tools:
            return await self._plain_chat(messages, max_tokens)
        if self._is_openai:
            return await self._chat_openai(messages, tools, max_tokens)
        else:
            return await self._chat_anthropic(messages, tools, max_tokens)

    async def chat_stream(
        self, messages: list[dict], tools: list[dict], max_tokens: int = 4096
    ) -> AsyncGenerator[str | LLMResponse, None]:
        """Streaming chat with tools. Yields text deltas (str), then final LLMResponse."""
        if self._is_openai:
            async for item in self._stream_openai(messages, tools, max_tokens):
                yield item
        else:
            async for item in self._stream_anthropic(messages, tools, max_tokens):
                yield item

    # --- Anthropic ---

    async def _chat_anthropic(self, messages: list[dict], tools: list[dict], max_tokens: int) -> LLMResponse:
        response = await self._anthropic.messages.create(
            model=self.model,
            max_tokens=max_tokens,
            tools=tools,
            messages=messages,
        )
        return self._parse_anthropic_response(response)

    async def _stream_anthropic(
        self, messages: list[dict], tools: list[dict], max_tokens: int
    ) -> AsyncGenerator[str | LLMResponse, None]:
        result = LLMResponse()
        current_tool: dict[str, Any] | None = None
        tool_json_buf = ""

        async with self._anthropic.messages.stream(
            model=self.model,
            max_tokens=max_tokens,
            tools=tools,
            messages=messages,
        ) as stream:
            async for event in stream:
                if event.type == "content_block_start":
                    block = event.content_block
                    if block.type == "tool_use":
                        current_tool = {"id": block.id, "name": block.name}
                        tool_json_buf = ""
                elif event.type == "content_block_delta":
                    delta = event.delta
                    if delta.type == "text_delta":
                        yield delta.text
                        result.text += delta.text
                    elif delta.type == "input_json_delta":
                        tool_json_buf += delta.partial_json
                elif event.type == "content_block_stop":
                    if current_tool:
                        try:
                            args = json.loads(tool_json_buf) if tool_json_buf else {}
                        except json.JSONDecodeError:
                            args = {}
                        result.tool_calls.append(ToolCall(
                            id=current_tool["id"],
                            name=current_tool["name"],
                            input=args,
                        ))
                        current_tool = None
                        tool_json_buf = ""
                elif event.type == "message_delta":
                    if hasattr(event, "usage") and event.usage:
                        result.output_tokens = getattr(event.usage, "output_tokens", 0)

            # Get final message for usage
            final = await stream.get_final_message()
            if hasattr(final, "usage") and final.usage:
                result.input_tokens = getattr(final.usage, "input_tokens", 0)
                result.output_tokens = getattr(final.usage, "output_tokens", 0)

        yield result

    def _parse_anthropic_response(self, response: Any) -> LLMResponse:
        result = LLMResponse(raw=response)
        if hasattr(response, "usage") and response.usage:
            result.input_tokens = getattr(response.usage, "input_tokens", 0)
            result.output_tokens = getattr(response.usage, "output_tokens", 0)
        for block in response.content:
            if block.type == "tool_use":
                result.tool_calls.append(ToolCall(id=block.id, name=block.name, input=block.input))
            elif block.type == "text":
                if result.text:
                    result.text += "\n"
                result.text += block.text
        return result

    # --- OpenAI ---

    async def _chat_openai(self, messages: list[dict], tools: list[dict], max_tokens: int) -> LLMResponse:
        openai_tools = self._to_openai_tools(tools)
        openai_messages = self._convert_messages_to_openai(messages)
        response = await self._openai.chat.completions.create(
            model=self.model,
            max_tokens=max_tokens,
            tools=openai_tools if openai_tools else None,
            messages=openai_messages,
        )
        return self._parse_openai_response(response)

    async def _stream_openai(
        self, messages: list[dict], tools: list[dict], max_tokens: int
    ) -> AsyncGenerator[str | LLMResponse, None]:
        openai_tools = self._to_openai_tools(tools)
        openai_messages = self._convert_messages_to_openai(messages)
        result = LLMResponse()
        # Track tool calls by index during streaming
        tool_call_bufs: dict[int, dict[str, str]] = {}

        stream = await self._openai.chat.completions.create(
            model=self.model,
            max_tokens=max_tokens,
            tools=openai_tools if openai_tools else None,
            messages=openai_messages,
            stream=True,
            stream_options={"include_usage": True},
        )
        async for chunk in stream:
            if chunk.usage:
                result.input_tokens = chunk.usage.prompt_tokens or 0
                result.output_tokens = chunk.usage.completion_tokens or 0

            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta
            if delta and delta.content:
                yield delta.content
                result.text += delta.content
            if delta and delta.tool_calls:
                for tc_delta in delta.tool_calls:
                    idx = tc_delta.index
                    if idx not in tool_call_bufs:
                        tool_call_bufs[idx] = {
                            "id": tc_delta.id or "",
                            "name": tc_delta.function.name if tc_delta.function and tc_delta.function.name else "",
                            "arguments": "",
                        }
                    buf = tool_call_bufs[idx]
                    if tc_delta.id:
                        buf["id"] = tc_delta.id
                    if tc_delta.function:
                        if tc_delta.function.name:
                            buf["name"] = tc_delta.function.name
                        if tc_delta.function.arguments:
                            buf["arguments"] += tc_delta.function.arguments

        # Finalize tool calls
        for _, buf in sorted(tool_call_bufs.items()):
            try:
                args = json.loads(buf["arguments"]) if buf["arguments"] else {}
            except json.JSONDecodeError:
                args = {}
            result.tool_calls.append(ToolCall(id=buf["id"], name=buf["name"], input=args))

        yield result

    def _parse_openai_response(self, response: Any) -> LLMResponse:
        result = LLMResponse(raw=response)
        if response.usage:
            result.input_tokens = response.usage.prompt_tokens or 0
            result.output_tokens = response.usage.completion_tokens or 0
        choice = response.choices[0] if response.choices else None
        if choice and choice.message:
            msg = choice.message
            if msg.content:
                result.text = msg.content
            if msg.tool_calls:
                for tc in msg.tool_calls:
                    try:
                        args = json.loads(tc.function.arguments)
                    except (json.JSONDecodeError, TypeError):
                        args = {}
                    result.tool_calls.append(ToolCall(
                        id=tc.id, name=tc.function.name, input=args,
                    ))
        return result

    # --- Plain chat (no tools) ---

    async def _plain_chat(self, messages: list[dict], max_tokens: int) -> LLMResponse:
        if self._is_openai:
            openai_messages = self._convert_messages_to_openai(messages)
            response = await self._openai.chat.completions.create(
                model=self.model,
                max_tokens=max_tokens,
                messages=openai_messages,
            )
            return self._parse_openai_response(response)
        else:
            response = await self._anthropic.messages.create(
                model=self.model,
                max_tokens=max_tokens,
                messages=messages,
            )
            result = LLMResponse(raw=response)
            if hasattr(response, "usage") and response.usage:
                result.input_tokens = getattr(response.usage, "input_tokens", 0)
                result.output_tokens = getattr(response.usage, "output_tokens", 0)
            for block in response.content:
                if block.type == "text":
                    result.text += block.text
            return result

    # --- Helpers ---

    @staticmethod
    def _to_openai_tools(tools: list[dict]) -> list[dict]:
        return [{
            "type": "function",
            "function": {
                "name": t["name"],
                "description": t.get("description", ""),
                "parameters": t.get("input_schema", {"type": "object", "properties": {}}),
            },
        } for t in tools]

    def _convert_messages_to_openai(self, messages: list[dict]) -> list[dict]:
        """Convert Anthropic-style messages to OpenAI format."""
        result = []
        for msg in messages:
            role = msg["role"]
            content = msg.get("content", "")

            if isinstance(content, str):
                result.append({"role": role, "content": content})
                continue

            if not isinstance(content, list):
                result.append({"role": role, "content": str(content)})
                continue

            if role == "assistant":
                text_parts = []
                tool_calls = []
                for block in content:
                    if isinstance(block, dict):
                        if block.get("type") == "tool_use":
                            tool_calls.append({
                                "id": block["id"],
                                "type": "function",
                                "function": {
                                    "name": block["name"],
                                    "arguments": json.dumps(block.get("input", {})),
                                },
                            })
                        elif block.get("type") == "text":
                            text_parts.append(block.get("text", ""))
                    elif hasattr(block, "type"):
                        if block.type == "tool_use":
                            tool_calls.append({
                                "id": block.id,
                                "type": "function",
                                "function": {
                                    "name": block.name,
                                    "arguments": json.dumps(block.input or {}),
                                },
                            })
                        elif block.type == "text":
                            text_parts.append(block.text)

                openai_msg: dict[str, Any] = {"role": "assistant"}
                openai_msg["content"] = "\n".join(text_parts) if text_parts else None
                if tool_calls:
                    openai_msg["tool_calls"] = tool_calls
                result.append(openai_msg)

            elif role == "user":
                tool_results = []
                text_parts = []
                for block in content:
                    if isinstance(block, dict) and block.get("type") == "tool_result":
                        tool_results.append(block)
                    elif isinstance(block, dict) and block.get("type") == "text":
                        text_parts.append(block.get("text", ""))
                    elif isinstance(block, str):
                        text_parts.append(block)

                if tool_results:
                    for tr in tool_results:
                        result.append({
                            "role": "tool",
                            "tool_call_id": tr.get("tool_use_id", ""),
                            "content": tr.get("content", ""),
                        })
                elif text_parts:
                    result.append({"role": "user", "content": "\n".join(text_parts)})
                else:
                    result.append({"role": "user", "content": str(content)})

        return result

    def to_anthropic_blocks(self, response: LLMResponse) -> list[dict]:
        """Convert an LLMResponse back to Anthropic-style content blocks for message history."""
        blocks = []
        if response.text:
            blocks.append({"type": "text", "text": response.text})
        for tc in response.tool_calls:
            blocks.append({
                "type": "tool_use",
                "id": tc.id,
                "name": tc.name,
                "input": tc.input,
            })
        return blocks
