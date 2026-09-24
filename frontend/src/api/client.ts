const BASE = "/api";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  let data: any;
  try {
    data = await res.json();
  } catch {
    if (!res.ok) {
      throw new Error(`Request failed: ${res.status} ${res.statusText}`);
    }
    throw new Error("Invalid response from server");
  }
  if (!res.ok) {
    throw new Error(data.error || data.detail || `Request failed: ${res.status}`);
  }
  return data;
}

export interface AuthConfig {
  type: "none" | "bearer" | "header" | "oauth" | "oauth_client_creds";
  token?: string;
  name?: string;
  value?: string;
  scope?: string;
  client_id?: string;
  client_secret?: string;
  client_auth?: "post" | "basic";
  client_metadata_url?: string;
  token_endpoint?: string;
}

export interface ConnectResult {
  status: "connected" | "oauth_redirect";
  serverInfo?: unknown;
  authorizationUrl?: string;
}

export const api = {
  // === Connection ===
  connect: (url: string, auth?: AuthConfig, model?: string, provider?: string, apiKey?: string, customEndpoint?: string, customContextWindow?: number, protocol?: string) =>
    request<ConnectResult>("/connect", {
      method: "POST",
      body: JSON.stringify({ url, auth, model: model || undefined, provider: provider || undefined, api_key: apiKey || undefined, custom_endpoint: customEndpoint || undefined, custom_context_window: customContextWindow || undefined, protocol: protocol && protocol !== "auto" ? protocol : undefined }),
    }),

  disconnect: () =>
    request<{ status: string }>("/disconnect", { method: "DELETE" }),

  signOut: (url: string) =>
    request<{ status: string; url: string; revoked?: boolean | null }>("/auth/signout", {
      method: "POST",
      body: JSON.stringify({ url }),
    }),

  status: () =>
    request<{ connected: boolean; serverInfo: unknown }>("/status"),

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

  listPrompts: () => request<{ prompts: unknown[] }>("/prompts"),

  getPrompt: (name: string, args: Record<string, string>) =>
    request<unknown>("/prompts/get", {
      method: "POST",
      body: JSON.stringify({ name, arguments: args }),
    }),

  loadResource: (uri: string) =>
    request<{ loaded: boolean; uri: string; name: string; tokens: number }>("/resources/load", {
      method: "POST",
      body: JSON.stringify({ uri }),
    }),

  unloadResource: (uri: string) =>
    request<{ loaded: boolean; uri: string }>("/resources/unload", {
      method: "POST",
      body: JSON.stringify({ uri }),
    }),

  // === Analysis ===
  getInventory: () =>
    request<unknown>("/analysis/inventory"),

  // === Optimize ===
  analyzeTools: () =>
    request<{ recommendations: any[]; quickWins: any[] }>("/optimize/analyze", {
      method: "POST",
    }),

  // === Results ===
  getRecommendations: () =>
    request<unknown>("/results/recommendations"),

  // === Optimization Runs ===
  getRun: (runId: string) => request<any>(`/results/runs/${runId}`),
};
