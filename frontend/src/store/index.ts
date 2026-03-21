import { create } from "zustand";
import { api } from "../api/client";
import type { AuthConfig } from "../api/client";

type ItemType = "tool" | "resource" | "prompt";
type AuthMethod = "none" | "bearer" | "header" | "oauth";

interface Selection {
  type: ItemType;
  item: any;
}

export interface ParamEntry {
  value: string | number | boolean;
  context: Record<string, unknown>; // sibling fields from the same object
  source: string; // tool/resource name that produced this
}


export type Tab = "connect" | "explore" | "optimize" | "results";

interface AppState {
  // Navigation
  activeTab: Tab;
  setActiveTab: (tab: Tab) => void;
  navigateToTool: (toolName: string, args?: Record<string, unknown>) => void;

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

  // Parameter Store — each key holds an array of entries with context
  parameterStore: Record<string, ParamEntry[]>;
  parameterAliases: Record<string, string>; // field name → store key
  removedAliases: Set<string>; // field names where user explicitly removed an auto-alias

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
  optimizeProgress: string | null;

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
const PARAMS_KEY = LS_PREFIX + "param-store";

const REMOVED_ALIASES_KEY = LS_PREFIX + "removed-aliases";

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

function loadRemovedAliases(): Set<string> {
  try {
    const raw = localStorage.getItem(REMOVED_ALIASES_KEY);
    if (raw) return new Set(JSON.parse(raw));
  } catch { /* ignore */ }
  return new Set();
}

function saveRemovedAliases(removed: Set<string>) {
  localStorage.setItem(REMOVED_ALIASES_KEY, JSON.stringify([...removed]));
}

function loadParamStore(): Record<string, ParamEntry[]> {
  try {
    const raw = localStorage.getItem(PARAMS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Migrate old format: Record<string, scalar> → Record<string, ParamEntry[]>
      const migrated: Record<string, ParamEntry[]> = {};
      for (const [key, val] of Object.entries(parsed)) {
        if (Array.isArray(val) && val.length > 0 && typeof val[0] === "object" && "value" in val[0]) {
          // Already new format
          migrated[key] = val as ParamEntry[];
        } else if (typeof val === "string" || typeof val === "number" || typeof val === "boolean") {
          // Old format — wrap in ParamEntry
          migrated[key] = [{ value: val, context: {}, source: "migrated" }];
        }
        // Skip non-scalar, non-array values
      }
      return migrated;
    }
  } catch { /* ignore */ }
  return {};
}

function saveParamStore(store: Record<string, ParamEntry[]>) {
  try {
    localStorage.setItem(PARAMS_KEY, JSON.stringify(store));
  } catch { /* ignore — may exceed quota */ }
}

function addParamEntry(
  store: Record<string, ParamEntry[]>,
  key: string,
  entry: ParamEntry,
): void {
  const existing = store[key] ?? [];
  // Don't add duplicate values
  const isDuplicate = existing.some(
    (e) => String(e.value) === String(entry.value)
  );
  if (!isDuplicate) {
    store[key] = [...existing, entry];
  }
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
  const [tools, resources, templates, prompts, inventoryRes] = await Promise.allSettled([
    api.listTools(),
    api.listResources(),
    api.listResourceTemplates(),
    api.listPrompts(),
    api.getInventory(),
  ]);

  set({
    tools: tools.status === "fulfilled" ? (tools.value as { tools: any[] }).tools : [],
    resources: resources.status === "fulfilled" ? (resources.value as { resources: any[] }).resources : [],
    resourceTemplates: templates.status === "fulfilled" ? (templates.value as { resourceTemplates: any[] }).resourceTemplates : [],
    prompts: prompts.status === "fulfilled" ? (prompts.value as { prompts: any[] }).prompts : [],
    inventory: inventoryRes.status === "fulfilled" ? inventoryRes.value : null,
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
  activeTab: "connect" as Tab,
  setActiveTab: (tab) => set({ activeTab: tab }),
  navigateToTool: (toolName, args) => {
    const tool = get().tools.find((t: any) => t.name === toolName);
    if (tool) {
      // Select the tool and switch to Explore
      set({ selection: { type: "tool", item: tool }, activeTab: "explore", result: null });
      // If args provided, seed them into the parameter store
      if (args) {
        const store = structuredClone(get().parameterStore);
        for (const [k, v] of Object.entries(args)) {
          if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
            addParamEntry(store, k, { value: v, context: args as Record<string, unknown>, source: "optimize" });
          }
        }
        saveParamStore(store);
        set({ parameterStore: store });
      }
    }
  },
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
  parameterStore: loadParamStore(),
  parameterAliases: loadAliases(),
  removedAliases: loadRemovedAliases(),
  evalResults: [],
  selectedEvalIndex: null,
  evalLoading: false,
  optimizeRunning: false,
  optimizeProgress: null,
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

      // Fallback: if SSE completed but we're still not connected, poll status
      if (!get().connected) {
        const statusRes = await api.status();
        if (statusRes.connected) {
          set({
            connected: true,
            connecting: false,
            serverInfo: statusRes.serverInfo,
            connectProgress: null,
            oauthPending: false,
          });
          await fetchCapabilities(set);
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      // Check if backend actually connected despite the error
      try {
        const statusRes = await api.status();
        if (statusRes.connected) {
          set({
            connected: true,
            connecting: false,
            serverInfo: statusRes.serverInfo,
            connectProgress: null,
            oauthPending: false,
          });
          await fetchCapabilities(set);
          return;
        }
      } catch { /* ignore */ }
      set({ connecting: false, oauthPending: false, error: message, connectProgress: null });
    }
  },

  disconnect: async () => {
    try {
      await api.disconnect();
    } catch {
      // ignore
    }
    saveParamStore({});
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
      evalResults: [],
      selectedEvalIndex: null,
      evalLoading: false,
      optimizeRunning: false,
      optimizeProgress: null,
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
    const store = structuredClone(get().parameterStore);
    for (const [k, v] of Object.entries(values)) {
      if (v !== "" && v !== undefined && v !== null && (typeof v === "string" || typeof v === "number" || typeof v === "boolean")) {
        addParamEntry(store, k, { value: v, context: values, source: "form input" });
      }
    }
    saveParamStore(store);
    set({ parameterStore: store });
  },

  harvestResultParams: (result) => {
    if (!result) return;
    const store = structuredClone(get().parameterStore);
    const source = get().selection?.item?.name ?? "unknown";

    // Extract text blocks from MCP result shapes
    const textBlocks: string[] = [];
    const contents = result.content ?? result.contents;
    if (Array.isArray(contents)) {
      for (const block of contents) {
        if (block.type === "text" && typeof block.text === "string") {
          textBlocks.push(block.text);
        } else if (typeof block.text === "string") {
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

    function harvestObject(obj: Record<string, unknown>) {
      const context: Record<string, unknown> = {};
      // Build context from all scalar fields
      for (const [k, v] of Object.entries(obj)) {
        if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
          context[k] = v;
        }
      }
      // Add each scalar as a param entry with full context
      for (const [k, v] of Object.entries(obj)) {
        if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
          addParamEntry(store, k, { value: v, context, source });
        }
      }
    }

    for (const text of textBlocks) {
      try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) {
          // Array of objects — harvest from each item
          for (const item of parsed) {
            if (item && typeof item === "object" && !Array.isArray(item)) {
              harvestObject(item as Record<string, unknown>);
            }
          }
        } else if (parsed && typeof parsed === "object") {
          // Single object — harvest directly
          harvestObject(parsed as Record<string, unknown>);
          // Also check nested arrays (e.g., { scouts: [...], summary: {...} })
          for (const v of Object.values(parsed)) {
            if (Array.isArray(v)) {
              for (const item of v) {
                if (item && typeof item === "object" && !Array.isArray(item)) {
                  harvestObject(item as Record<string, unknown>);
                }
              }
            }
          }
        }
      } catch {
        // not JSON, skip
      }
    }
    saveParamStore(store);
    set({ parameterStore: store });
  },

  clearParamStore: () => { saveParamStore({}); set({ parameterStore: {} as Record<string, ParamEntry[]> }); },

  addParamAlias: (fieldName, storeKey) => {
    const aliases = { ...get().parameterAliases, [fieldName]: storeKey };
    // Remove from the "removed" set since user is explicitly adding it
    const removed = new Set(get().removedAliases);
    removed.delete(fieldName);
    saveAliases(aliases);
    saveRemovedAliases(removed);
    set({ parameterAliases: aliases, removedAliases: removed });
  },

  removeParamAlias: (fieldName) => {
    const aliases = { ...get().parameterAliases };
    delete aliases[fieldName];
    // Track that user explicitly removed this so it won't be auto-added again
    const removed = new Set(get().removedAliases);
    removed.add(fieldName);
    saveAliases(aliases);
    saveRemovedAliases(removed);
    set({ parameterAliases: aliases, removedAliases: removed });
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
                    usage: data.usage,
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
    set({ optimizeRunning: true, optimizeProgress: "Starting optimization..." });
    try {
      const response = await fetch("/api/optimize/run", { method: "POST" });

      if (!response.ok && !response.headers.get("content-type")?.includes("text/event-stream")) {
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
              if (currentEvent === "progress") {
                set({ optimizeProgress: data.message });
              } else if (currentEvent === "done") {
                // Fetch final results from backend
                const [comparison, recs] = await Promise.allSettled([
                  api.getComparison(),
                  api.getRecommendations(),
                ]);
                set({
                  optimizeRunning: false,
                  optimizeProgress: null,
                  comparison: data.comparison ?? (comparison.status === "fulfilled" ? comparison.value : null),
                  recommendations: recs.status === "fulfilled" ? (recs.value as any)?.recommendations ?? recs.value : [],
                  activeTab: "results",
                });
              } else if (currentEvent === "error") {
                set({ optimizeRunning: false, optimizeProgress: null, error: data.message });
              }
            } catch { /* skip */ }
            currentEvent = "";
          }
        }
      }

      if (get().optimizeRunning) {
        set({ optimizeRunning: false, optimizeProgress: null });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      set({ optimizeRunning: false, optimizeProgress: null, error: message });
    }
  },

  selectEval: (index) => set({ selectedEvalIndex: index }),
}));
