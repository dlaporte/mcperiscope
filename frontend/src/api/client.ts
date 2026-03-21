const BASE = "/api";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || data.detail || `Request failed: ${res.status}`);
  }
  return data;
}

export interface AuthConfig {
  type: "none" | "bearer" | "header" | "oauth";
  token?: string;
  name?: string;
  value?: string;
}

export interface ConnectResult {
  status: "connected" | "oauth_redirect";
  serverInfo?: unknown;
  authorizationUrl?: string;
}

export interface ModelConfig {
  model: string;
  apiKey: string;
}

export const api = {
  // === Connection ===
  connect: (url: string, auth?: AuthConfig, model?: string, apiKey?: string) =>
    request<ConnectResult>("/connect", {
      method: "POST",
      body: JSON.stringify({ url, auth, model: model || undefined, api_key: apiKey || undefined }),
    }),

  disconnect: () =>
    request<{ status: string }>("/disconnect", { method: "DELETE" }),

  status: () =>
    request<{ connected: boolean; serverInfo: unknown }>("/status"),

  authCallback: (callbackUrl: string, model?: string, apiKey?: string) =>
    request<ConnectResult>("/auth/callback", {
      method: "POST",
      body: JSON.stringify({ callback_url: callbackUrl, model: model || undefined, api_key: apiKey || undefined }),
    }),

  // === Explore ===
  listTools: () => request<{ tools: unknown[] }>("/tools"),

  callTool: (name: string, args: Record<string, unknown>) =>
    request<unknown>("/tools/call", {
      method: "POST",
      body: JSON.stringify({ name, arguments: args }),
    }),

  listResources: () => request<{ resources: unknown[] }>("/resources"),

  readResource: (uri: string) =>
    request<unknown>("/resources/read", {
      method: "POST",
      body: JSON.stringify({ uri }),
    }),

  listResourceTemplates: () =>
    request<{ resourceTemplates: unknown[] }>("/resource-templates"),

  listPrompts: () => request<{ prompts: unknown[] }>("/prompts"),

  getPrompt: (name: string, args: Record<string, string>) =>
    request<unknown>("/prompts/get", {
      method: "POST",
      body: JSON.stringify({ name, arguments: args }),
    }),

  // === Analysis ===
  getInventory: () =>
    request<unknown>("/analysis/inventory"),

  getToolStats: () =>
    request<unknown>("/analyze/tool-stats"),

  // === Optimize ===
  evaluate: (prompt: string) =>
    request<unknown>("/optimize/evaluate", {
      method: "POST",
      body: JSON.stringify({ prompt }),
    }),

  submitRating: (promptIndex: number, correctness: string, notes: string) =>
    request<unknown>("/optimize/rate", {
      method: "POST",
      body: JSON.stringify({ prompt_index: promptIndex, correctness, notes }),
    }),

  runOptimize: () =>
    request<unknown>("/optimize/run", {
      method: "POST",
    }),

  // === Results ===
  getComparison: () =>
    request<unknown>("/results/comparison"),

  getRecommendations: () =>
    request<unknown>("/results/recommendations"),

  getReportHtml: () =>
    request<unknown>("/results/report/html"),

  getReportMd: () =>
    request<unknown>("/results/report/md"),

  getPlan: () =>
    request<unknown>("/results/plan"),

  getProxyCode: () =>
    request<unknown>("/results/proxy"),
};
