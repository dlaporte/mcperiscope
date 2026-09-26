import { describe, expect, it } from "vitest";
import {
  includedBackendIndices,
  llmRequestFields,
  readSSE,
  selectContextWindow,
} from "./index";
import type { EvalResult, LLMConfig } from "./index";

function streamOf(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body);
}

async function collect(chunks: string[]): Promise<Array<[string, unknown]>> {
  const events: Array<[string, unknown]> = [];
  await readSSE(streamOf(chunks), (event, data) => {
    events.push([event, data]);
  });
  return events;
}

function llm(overrides: Partial<LLMConfig>): LLMConfig {
  return {
    id: "a",
    name: "LLM",
    provider: "anthropic",
    model: "claude-test",
    apiKey: "key",
    endpoint: "",
    contextWindow: 0,
    ...overrides,
  };
}

describe("readSSE", () => {
  it("pairs an event with data that arrives in a later chunk", async () => {
    expect(await collect(["event: progress\n", 'data: {"message":"hi"}\n\n'])).toEqual([
      ["progress", { message: "hi" }],
    ]);
  });

  it("handles lines split mid-way across chunks", async () => {
    expect(await collect(["eve", "nt: done\nda", 'ta: {"ok":', "true}\n\n"])).toEqual([
      ["done", { ok: true }],
    ]);
  });

  it("accepts CRLF line endings", async () => {
    expect(await collect(['event: a\r\ndata: 1\r\n\r\nevent: b\r\ndata: 2\r\n\r\n'])).toEqual([
      ["a", 1],
      ["b", 2],
    ]);
  });

  it("drops data whose event was reset by a blank line", async () => {
    expect(await collect(["event: a\n\n", "data: 1\n\n", "event: b\ndata: 2\n\n"])).toEqual([
      ["b", 2],
    ]);
  });
});

describe("llmRequestFields", () => {
  it("sends an empty endpoint for built-in providers so the backend clears a stale one", () => {
    for (const provider of ["anthropic", "openai"] as const) {
      const fields = llmRequestFields(llm({ provider, endpoint: "https://old.example.com" }));
      expect(fields.custom_endpoint).toBe("");
    }
  });

  it("keeps the endpoint for a custom provider", () => {
    const fields = llmRequestFields(llm({ provider: "custom", endpoint: "https://llm.example.com/v1" }));
    expect(fields.custom_endpoint).toBe("https://llm.example.com/v1");
  });

  it("sends the context window", () => {
    expect(llmRequestFields(llm({ contextWindow: 64_000 })).custom_context_window).toBe(64_000);
  });

  it("sends nothing without a config", () => {
    expect(llmRequestFields(undefined)).toEqual({
      model: undefined,
      api_key: undefined,
      provider: undefined,
      custom_endpoint: undefined,
      custom_context_window: undefined,
    });
  });
});

describe("selectContextWindow", () => {
  const state = (config: Partial<LLMConfig> | null, inventoryWindow?: number) => ({
    llmConfigs: config ? [llm({ id: "p", ...config })] : [],
    primaryLLM: "p",
    inventory: inventoryWindow ? { contextWindow: inventoryWindow } : null,
  });

  it("prefers the primary config's context window", () => {
    expect(selectContextWindow(state({ contextWindow: 50_000 }, 200_000))).toBe(50_000);
  });

  it("falls back to the known model size", () => {
    expect(selectContextWindow(state({ model: "claude-haiku-4-5-20251001", contextWindow: 0 }, 500_000))).toBe(200_000);
  });

  it("then to the connect-time inventory figure", () => {
    expect(selectContextWindow(state({ model: "unknown-model", contextWindow: 0 }, 500_000))).toBe(500_000);
  });

  it("then to 128k", () => {
    expect(selectContextWindow(state(null))).toBe(128_000);
  });
});

describe("includedBackendIndices", () => {
  const ev = (backendIndex?: number): EvalResult => ({
    prompt: "p",
    answer: "a",
    toolChain: [],
    traceEvents: [],
    backendIndex,
  });

  it("maps included positions to sorted backend indices, skipping unfinished evals", () => {
    const evalResults = [ev(4), ev(), ev(1), ev(7)];
    expect(includedBackendIndices({ evalResults, evalIncluded: new Set([3, 1, 0, 2]) })).toEqual([1, 4, 7]);
  });

  it("ignores positions past the end", () => {
    expect(includedBackendIndices({ evalResults: [ev(0)], evalIncluded: new Set([0, 5]) })).toEqual([0]);
  });
});
