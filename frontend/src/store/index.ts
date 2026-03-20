import { create } from "zustand";
import { api } from "../api/client";
import type { AuthConfig } from "../api/client";

type ItemType = "tool" | "resource" | "prompt";
type AuthMethod = "none" | "bearer" | "header" | "oauth";

interface Selection {
  type: ItemType;
  item: any;
}

interface AppState {
  // Connection
  connected: boolean;
  connecting: boolean;
  serverInfo: unknown;
  error: string | null;

  // Auth
  authMethod: AuthMethod;
  authToken: string;
  headerName: string;
  headerValue: string;
  oauthPending: boolean;
  connectProgress: string | null;

  // Model config
  model: string;
  apiKey: string;

  // Explore data
  tools: any[];
  resources: any[];
  resourceTemplates: any[];
  prompts: any[];
  inventory: any | null;

  // UI
  selection: Selection | null;
  result: any;
  resultLoading: boolean;

  // Parameter Store
  parameterStore: Record<string, unknown>;
  parameterAliases: Record<string, string>; // field name → store key

  // Optimize
  evalResults: Array<{
    prompt: string;
    answer: string;
    toolChain: Array<{
      step: number;
      tool: string;
      input: Record<string, unknown>;
      output: string;
      duration: number;
      error: string | null;
    }>;
    traceEvents: unknown[];
    rating?: { correctness: string; notes: string };
  }>;
  selectedEvalIndex: number | null;
  evalLoading: boolean;
  optimizeRunning: boolean;

  // Results
  comparison: any;
  recommendations: any[];
  resultsLoading: boolean;

  // Actions
  fetchComparison: () => Promise<void>;
  fetchRecommendations: () => Promise<void>;
  checkStatus: () => Promise<void>;
  setAuthMethod: (method: AuthMethod) => void;
  setAuthToken: (token: string) => void;
  setHeaderName: (name: string) => void;
  setHeaderValue: (value: string) => void;
  setModel: (model: string) => void;
  setApiKey: (apiKey: string) => void;
  connect: (url: string) => Promise<void>;
  disconnect: () => Promise<void>;
  completeOAuth: (code: string) => Promise<void>;
  select: (type: ItemType, item: any) => void;
  clearSelection: () => void;
  callTool: (name: string, args: Record<string, unknown>) => Promise<void>;
  readResource: (uri: string) => Promise<void>;
  getPrompt: (name: string, args: Record<string, string>) => Promise<void>;
  harvestParams: (values: Record<string, unknown>) => void;
  harvestResultParams: (result: any) => void;
  clearParamStore: () => void;
  addParamAlias: (fieldName: string, storeKey: string) => void;
  removeParamAlias: (fieldName: string) => void;

  // Optimize actions
  evaluate: (prompt: string) => Promise<void>;
  submitRating: (index: number, correctness: string, notes: string) => Promise<void>;
  runOptimize: () => Promise<void>;
  selectEval: (index: number) => void;
}

const LS_PREFIX = "mcperiscope:";

function lsGet(key: string): string {
  try {
    return localStorage.getItem(LS_PREFIX + key) ?? "";
  } catch {
    return "";
  }
}

function lsSet(key: string, value: string) {
  try {
    localStorage.setItem(LS_PREFIX + key, value);
  } catch { /* ignore */ }
}

const ALIASES_KEY = LS_PREFIX + "param-aliases";

function loadAliases(): Record<string, string> {
  try {
    const raw = localStorage.getItem(ALIASES_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return {};
}

function saveAliases(aliases: Record<string, string>) {
  localStorage.setItem(ALIASES_KEY, JSON.stringify(aliases));
}

function buildAuthConfig(state: AppState): AuthConfig | undefined {
  switch (state.authMethod) {
    case "none":
      return undefined;
    case "bearer":
      return { type: "bearer", token: state.authToken };
    case "header":
      return { type: "header", name: state.headerName, value: state.headerValue };
    case "oauth":
      return { type: "oauth" };
  }
}

async function fetchCapabilities(set: (partial: Partial<AppState>) => void) {
  const [tools, resources, templates, prompts] = await Promise.allSettled([
    api.listTools(),
    api.listResources(),
    api.listResourceTemplates(),
    api.listPrompts(),
  ]);

  set({
    tools: tools.status === "fulfilled" ? (tools.value as { tools: any[] }).tools : [],
    resources: resources.status === "fulfilled" ? (resources.value as { resources: any[] }).resources : [],
    resourceTemplates: templates.status === "fulfilled" ? (templates.value as { resourceTemplates: any[] }).resourceTemplates : [],
    prompts: prompts.status === "fulfilled" ? (prompts.value as { prompts: any[] }).prompts : [],
  });
}

async function consumeConnectSSE(
  response: Response,
  set: (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void,
  get: () => AppState,
) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    let currentEvent = "";
    for (const line of lines) {
      if (line.startsWith("event: ")) {
        currentEvent = line.slice(7).trim();
      } else if (line.startsWith("data: ") && currentEvent) {
        try {
          const data = JSON.parse(line.slice(6));
          if (currentEvent === "progress") {
            set({ connectProgress: data.message });
          } else if (currentEvent === "oauth_redirect") {
            set({ connecting: false, oauthPending: true, connectProgress: null });
            window.location.href = data.authorizationUrl;
            return;
          } else if (currentEvent === "done") {
            set({
              connected: true,
              connecting: false,
              oauthPending: false,
              serverInfo: data.serverInfo,
              connectProgress: null,
            });
            await fetchCapabilities(set);
          } else if (currentEvent === "error") {
            set({
              connecting: false,
              oauthPending: false,
              error: data.message,
              connectProgress: null,
            });
          }
        } catch { /* skip unparseable */ }
        currentEvent = "";
      }
    }
  }

  if (get().connecting) {
    set({ connecting: false, connectProgress: null });
  }
}

export const useStore = create<AppState>((set, get) => ({
  connected: false,
  connecting: false,
  serverInfo: null,
  error: null,
  authMethod: (lsGet("authMethod") || "none") as "none" | "bearer" | "header" | "oauth",
  authToken: lsGet("authToken"),
  headerName: lsGet("headerName"),
  headerValue: lsGet("headerValue"),
  oauthPending: false,
  connectProgress: null,
  model: lsGet("model") || "claude-sonnet-4-6",
  apiKey: lsGet("apiKey"),
  tools: [],
  resources: [],
  resourceTemplates: [],
  prompts: [],
  inventory: null,
  selection: null,
  result: null,
  resultLoading: false,
  parameterStore: {},
  parameterAliases: loadAliases(),
  evalResults: [],
  selectedEvalIndex: null,
  evalLoading: false,
  optimizeRunning: false,
  comparison: null,
  recommendations: [],
  resultsLoading: false,

  fetchComparison: async () => {
    set({ resultsLoading: true });
    try {
      const data = await api.getComparison();
      set({ comparison: data, resultsLoading: false });
    } catch {
      set({ resultsLoading: false });
    }
  },

  fetchRecommendations: async () => {
    try {
      const data = await api.getRecommendations() as { recommendations: any[] };
      set({ recommendations: data.recommendations });
    } catch {
      // no recommendations yet
    }
  },

  checkStatus: async () => {
    try {
      const res = await api.status();
      if (res.connected) {
        set({ connected: true, serverInfo: res.serverInfo });
        await fetchCapabilities(set);
      }
    } catch {
      // Backend not reachable, stay disconnected
    }
  },

  setAuthMethod: (method) => { lsSet("authMethod", method); set({ authMethod: method }); },
  setAuthToken: (token) => { lsSet("authToken", token); set({ authToken: token }); },
  setHeaderName: (name) => { lsSet("headerName", name); set({ headerName: name }); },
  setHeaderValue: (value) => { lsSet("headerValue", value); set({ headerValue: value }); },

  setModel: (model) => {
    lsSet("model", model);
    set({ model });
  },

  setApiKey: (apiKey) => {
    lsSet("apiKey", apiKey);
    set({ apiKey });
  },

  connect: async (url: string) => {
    set({ connecting: true, error: null, oauthPending: false, connectProgress: null });
    try {
      const state = get();
      const authConfig = buildAuthConfig(state);
      const res = await api.connect(url, authConfig, state.model, state.apiKey);

      if (res.status === "oauth_redirect" && res.authorizationUrl) {
        set({ connecting: false, oauthPending: true });
        window.location.href = res.authorizationUrl;
        return;
      }

      set({ connected: true, connecting: false, serverInfo: res.serverInfo, connectProgress: null });
      await fetchCapabilities(set);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      set({ connecting: false, error: message, connectProgress: null });
    }
  },

  completeOAuth: async (callbackUrl: string) => {
    set({ connecting: true, error: null, connectProgress: "Starting authentication..." });
    try {
      const state = get();
      const response = await fetch("/api/auth/callback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callback_url: callbackUrl,
          model: state.model || undefined,
          api_key: state.apiKey || undefined,
        }),
      });

      if (!response.ok && !response.headers.get("content-type")?.includes("text/event-stream")) {
        const err = await response.json().catch(() => ({ detail: response.statusText }));
        throw new Error(err.detail || response.statusText);
      }

      await consumeConnectSSE(response, set, get);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      set({ connecting: false, oauthPending: false, error: message, connectProgress: null });
    }
  },

  disconnect: async () => {
    try {
      await api.disconnect();
    } catch {
      // ignore
    }
    set({
      connected: false,
      serverInfo: null,
      oauthPending: false,
      tools: [],
      resources: [],
      resourceTemplates: [],
      prompts: [],
      inventory: null,
      selection: null,
      result: null,
      parameterStore: {},
      comparison: null,
      recommendations: [],
    });
  },

  select: (type, item) => set({ selection: { type, item }, result: null }),
  clearSelection: () => set({ selection: null, result: null }),

  callTool: async (name, args) => {
    set({ resultLoading: true, result: null });
    try {
      const result = await api.callTool(name, args);
      set({ result, resultLoading: false });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      set({ result: { error: message }, resultLoading: false });
    }
  },

  readResource: async (uri) => {
    set({ resultLoading: true, result: null });
    try {
      const result = await api.readResource(uri);
      set({ result, resultLoading: false });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      set({ result: { error: message }, resultLoading: false });
    }
  },

  getPrompt: async (name, args) => {
    set({ resultLoading: true, result: null });
    try {
      const result = await api.getPrompt(name, args);
      set({ result, resultLoading: false });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      set({ result: { error: message }, resultLoading: false });
    }
  },

  harvestParams: (values) => {
    const store = { ...get().parameterStore };
    for (const [k, v] of Object.entries(values)) {
      if (v !== "" && v !== undefined && v !== null) {
        store[k] = v;
      }
    }
    set({ parameterStore: store });
  },

  harvestResultParams: (result) => {
    if (!result) return;
    const store = { ...get().parameterStore };
    // Handle MCP result shapes: { content: [...] }, { messages: [...] }, or direct object
    const textBlocks: string[] = [];
    const contents = result.content ?? result.contents;
    if (Array.isArray(contents)) {
      for (const block of contents) {
        if (block.type === "text" && typeof block.text === "string") {
          textBlocks.push(block.text);
        }
      }
    }
    if (result.messages && Array.isArray(result.messages)) {
      for (const msg of result.messages) {
        if (msg.content && typeof msg.content === "object" && msg.content.type === "text") {
          textBlocks.push(msg.content.text);
        }
      }
    }
    for (const text of textBlocks) {
      try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          for (const [k, v] of Object.entries(parsed)) {
            if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
              store[k] = v;
            }
          }
        }
      } catch {
        // not JSON, skip
      }
    }
    set({ parameterStore: store });
  },

  clearParamStore: () => set({ parameterStore: {} }),

  addParamAlias: (fieldName, storeKey) => {
    const aliases = { ...get().parameterAliases, [fieldName]: storeKey };
    saveAliases(aliases);
    set({ parameterAliases: aliases });
  },

  removeParamAlias: (fieldName) => {
    const aliases = { ...get().parameterAliases };
    delete aliases[fieldName];
    saveAliases(aliases);
    set({ parameterAliases: aliases });
  },

  // Optimize actions
  evaluate: async (prompt) => {
    // Add a placeholder entry immediately and select it
    const placeholderIndex = get().evalResults.length;
    set((state) => ({
      evalLoading: true,
      evalResults: [
        ...state.evalResults,
        { prompt, answer: "", toolChain: [], traceEvents: [] },
      ],
      selectedEvalIndex: placeholderIndex,
    }));

    try {
      const response = await fetch("/api/optimize/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ detail: response.statusText }));
        throw new Error(err.detail || response.statusText);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        let currentEvent = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith("data: ") && currentEvent) {
            try {
              const data = JSON.parse(line.slice(6));
              if (currentEvent === "tool_calling") {
                // Add an in-progress step to the tool chain
                set((state) => {
                  const evalResults = [...state.evalResults];
                  const entry = { ...evalResults[placeholderIndex] };
                  entry.toolChain = [
                    ...entry.toolChain,
                    { step: data.step, tool: data.tool, input: data.input, output: "Calling...", duration: 0, error: null },
                  ];
                  evalResults[placeholderIndex] = entry;
                  return { evalResults };
                });
              } else if (currentEvent === "tool_result") {
                // Update the last step with the result
                set((state) => {
                  const evalResults = [...state.evalResults];
                  const entry = { ...evalResults[placeholderIndex] };
                  const chain = [...entry.toolChain];
                  const lastIdx = chain.findIndex((s) => s.step === data.step);
                  if (lastIdx >= 0) {
                    chain[lastIdx] = data;
                  } else {
                    chain.push(data);
                  }
                  entry.toolChain = chain;
                  evalResults[placeholderIndex] = entry;
                  return { evalResults };
                });
              } else if (currentEvent === "done") {
                // Final result
                set((state) => {
                  const evalResults = [...state.evalResults];
                  evalResults[placeholderIndex] = {
                    prompt: data.prompt,
                    answer: data.answer,
                    toolChain: data.toolChain,
                    traceEvents: data.traceEvents,
                  };
                  return { evalResults, evalLoading: false };
                });
              } else if (currentEvent === "error") {
                set((state) => {
                  const evalResults = [...state.evalResults];
                  evalResults[placeholderIndex] = {
                    ...evalResults[placeholderIndex],
                    answer: `Error: ${data.message}`,
                  };
                  return { evalResults, evalLoading: false };
                });
              }
            } catch {
              // Skip unparseable SSE data
            }
            currentEvent = "";
          }
        }
      }

      // Ensure loading is cleared
      set({ evalLoading: false });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      set((state) => {
        const evalResults = [...state.evalResults];
        evalResults[placeholderIndex] = {
          ...evalResults[placeholderIndex],
          answer: `Error: ${message}`,
        };
        return { evalResults, evalLoading: false };
      });
    }
  },

  submitRating: async (index, correctness, notes) => {
    try {
      await api.submitRating(index, correctness, notes);
      set((state) => {
        const evalResults = [...state.evalResults];
        if (evalResults[index]) {
          evalResults[index] = {
            ...evalResults[index],
            rating: { correctness, notes },
          };
        }
        return { evalResults };
      });
    } catch {
      // ignore rating errors
    }
  },

  runOptimize: async () => {
    set({ optimizeRunning: true });
    try {
      await api.runOptimize();
      set({ optimizeRunning: false });
    } catch {
      set({ optimizeRunning: false });
    }
  },

  selectEval: (index) => set({ selectedEvalIndex: index }),
}));
