const BASE = "/api";

// Error message of a failed response: FastAPI's `detail`, else the status
async function errorDetail(res: Response): Promise<string> {
  try {
    const { detail } = await res.json();
    if (detail) return typeof detail === "string" ? detail : JSON.stringify(detail);
  } catch { /* not JSON */ }
  return `Request failed: ${res.status} ${res.statusText}`.trim();
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) throw new Error(await errorDetail(res));
  try {
    return await res.json();
  } catch {
    throw new Error("Invalid response from server");
  }
}

// GET a text endpoint (markdown plan, HTML report, proxy source)
export async function requestText(path: string): Promise<string> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(await errorDetail(res));
  return res.text();
}

// POST JSON to a `text/event-stream` endpoint; the caller reads the stream
export async function postSSE(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok && !res.headers.get("content-type")?.includes("text/event-stream")) {
    throw new Error(await errorDetail(res));
  }
  return res;
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

interface ConnectResult {
  status: "connected" | "oauth_redirect";
  serverInfo?: unknown;
  authorizationUrl?: string;
}

interface ConnectRequest {
  url: string;
  auth?: AuthConfig;
  protocol?: "auto" | "http" | "sse";
  model?: string;
  provider?: string;
  api_key?: string;
  custom_endpoint?: string;
  custom_context_window?: number;
}

export const api = {
  // === Connection ===
  connect: (req: ConnectRequest) =>
    request<ConnectResult>("/connect", {
      method: "POST",
      body: JSON.stringify({ ...req, protocol: req.protocol !== "auto" ? req.protocol : undefined }),
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

  getToolAnalysis: (toolName: string) =>
    request<any>(`/analysis/tool/${encodeURIComponent(toolName)}`),

  // === Optimize ===
  getEvalContext: (backendIndex: number) =>
    request<any>(`/optimize/context/${backendIndex}`),

  analyzeTools: () =>
    request<{ recommendations: any[]; quickWins: any[] }>("/optimize/analyze", {
      method: "POST",
    }),

  // === Results ===
  getRecommendations: () =>
    request<{ recommendations: any[]; quickWins: any[]; analysisStale?: boolean }>("/results/recommendations"),

  // Baseline side of the comparison over the given backend eval indices
  getBaseline: (included: number[]) =>
    request<Record<string, number>>(`/results/baseline?included=${included.join(",")}`),

  deleteEval: (backendIndex: number) =>
    request<unknown>(`/optimize/eval/${backendIndex}`, { method: "DELETE" }),

  // === Optimization Runs ===
  getRun: (runId: string) => request<any>(`/results/runs/${encodeURIComponent(runId)}`),
};
