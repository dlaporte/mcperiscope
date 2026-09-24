import { create } from "zustand";
import { api } from "../api/client";
import type { AuthConfig } from "../api/client";
import { KNOWN_MODELS, MODEL_CONTEXT } from "../config/models";
import { estimateTokens } from "../utils/tokens";

export function generateId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

type ItemType = "tool" | "resource" | "prompt";
type AuthMethod = "none" | "bearer" | "header" | "oauth" | "oauth_client_creds";
export type MCPProtocol = "auto" | "http" | "sse";

interface Selection {
  type: ItemType;
  item: any;
}

export interface ParamEntry {
  value: string | number | boolean;
  context: Record<string, unknown>; // sibling fields from the same object
  source: string; // tool/resource name that produced this
}


export interface LLMConfig {
  id: string;          // unique ID (generateId())
  name: string;        // user-defined label
  provider: "anthropic" | "openai" | "custom";
  model: string;       // model ID
  apiKey: string;      // API key
  endpoint: string;    // custom endpoint URL (empty for anthropic/openai)
  contextWindow: number; // context window size
}

export interface MCPServerConfig {
  id: string;
  name: string;        // user-defined label (e.g., "Scoutbook MCP", "Local Dev")
  url: string;         // MCP server URL
  authMethod: AuthMethod;
  authToken: string;   // for bearer auth
  headerName: string;  // for header auth
  headerValue: string; // for header auth
  scope: string;             // oauth + client-creds: scope override (space-separated)
  clientId: string;          // oauth: pre-registered client; client-creds: required
  clientSecret: string;      // oauth: optional; client-creds: required
  clientAuth: "post" | "basic"; // token endpoint auth method when a secret is set
  clientMetadataUrl: string; // oauth: CIMD URL (alternative to dynamic registration)
  tokenEndpoint: string;     // client-creds: token endpoint URL
  protocol: MCPProtocol;     // transport: auto-detect / Streamable HTTP / legacy SSE
}

export const MCP_CONFIG_DEFAULTS = {
  scope: "",
  clientId: "",
  clientSecret: "",
  clientAuth: "post" as const,
  clientMetadataUrl: "",
  tokenEndpoint: "",
  protocol: "auto" as const,
};

export type Tab = "connect" | "explore" | "evaluate" | "optimize" | "settings";

interface OptimizationRun {
  id: string;
  timestamp: number;
  name: string;
  enabledRecIds: string[];
  comparison: any;
  analystResults: any[];
  proxyAnswers: Array<{ prompt: string; answer: string }>;
  condensedResources?: Record<string, {name: string; original: string; condensed: string; originalTokens: number; condensedTokens: number}>;
}

export interface EvalResult {
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
  usage?: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    peak_context_tokens: number;
    api_rounds: number;
  };
  // Index of this eval in the backend session; stable across client-side deletes
  backendIndex?: number;
}

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
  oauthPending: boolean;
  connectProgress: string | null;

  // LLM configurations
  llmConfigs: LLMConfig[];
  primaryLLM: string;   // ID of the primary LLM config
  analystLLM: string;      // ID of the analyst LLM config

  // LLM config actions
  addLLMConfig: (config: LLMConfig) => void;
  updateLLMConfig: (id: string, updates: Partial<LLMConfig>) => void;
  removeLLMConfig: (id: string) => void;
  setPrimaryLLM: (id: string) => void;
  setAnalystLLM: (id: string) => void;
  getAnalystConfig: () => LLMConfig | null;

  // MCP server configurations
  mcpConfigs: MCPServerConfig[];
  addMCPConfig: (config: MCPServerConfig) => void;
  updateMCPConfig: (id: string, updates: Partial<MCPServerConfig>) => void;
  removeMCPConfig: (id: string) => void;

  // Evaluation settings
  maxToolRounds: number;
  maxTokensPerResponse: number;
  setMaxToolRounds: (n: number) => void;
  setMaxTokensPerResponse: (n: number) => void;

  // Explore data
  tools: any[];
  resources: any[];
  prompts: any[];
  inventory: any | null;

  // UI
  selection: Selection | null;
  result: any;
  resultLoading: boolean;
  resultMeta: { durationMs: number; tokens: number } | null;

  // Parameter Store — each key holds an array of entries with context
  parameterStore: Record<string, ParamEntry[]>;
  parameterAliases: Record<string, string>; // field name → store key
  removedAliases: Set<string>; // field names where user explicitly removed an auto-alias

  // Loaded resources for evaluation context
  loadedResources: Array<{ uri: string; name: string; tokens: number }>;

  // Optimize
  evalResults: EvalResult[];
  selectedEvalIndex: number | null;
  evalIncluded: Set<number>;
  toggleEvalIncluded: (index: number) => void;
  evalLoading: boolean;
  liveContextTokens: number;
  optimizeRunning: boolean;
  optimizeProgress: string | null;

  // Results
  recommendations: any[];
  quickWins: any[];
  planMarkdown: string;

  // Optimization workbench
  optimizationRuns: OptimizationRun[];
  selectedRunId: string | null;
  enabledRecIds: Set<string>;

  // Disabled inventory items
  disabledTools: Set<string>;
  disabledResources: Set<string>;
  disabledPrompts: Set<string>;
  toggleDisabledTool: (name: string) => void;
  toggleDisabledResource: (uri: string) => void;
  toggleDisabledPrompt: (name: string) => void;
  setAllToolsEnabled: (enabled: boolean) => void;
  setAllResourcesEnabled: (enabled: boolean) => void;
  setAllPromptsEnabled: (enabled: boolean) => void;

  // Optimization workbench actions
  analyzeTools: () => Promise<void>;
  toggleRecEnabled: (id: string) => void;
  setAllRecsEnabled: (enabled: boolean) => void;
  selectRun: (runId: string | null) => void;
  runOptimizeWithSelection: () => Promise<void>;

  // Actions
  fetchRecommendations: () => Promise<void>;
  fetchPlan: () => Promise<void>;
  checkStatus: () => Promise<void>;
  connect: (config: MCPServerConfig) => Promise<void>;
  disconnect: () => Promise<void>;
  signOutMCP: (url: string) => Promise<void>;
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

  // Resource loading
  toggleResource: (uri: string) => Promise<void>;

  // Optimize actions
  evaluate: (prompt: string) => Promise<void>;
  removeEval: (index: number) => void;
  selectEval: (index: number) => void;
}

export const LS_PREFIX = "mcperiscope:";

// sessionStorage key: OAuthCallback stashes the callback URL here for ConnectTab to finish
export const PENDING_OAUTH_KEY = LS_PREFIX + "pending-oauth-callback";

// Pre-LLMConfig flat model settings, read only by migrateToLLMConfigs()
const LEGACY_LLM_KEYS = ["model", "apiKey", "customEndpoint", "customContextWindow"];

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

function buildAuthConfig(config: MCPServerConfig): AuthConfig | undefined {
  switch (config.authMethod) {
    case "none":
      return undefined;
    case "bearer":
      return { type: "bearer", token: config.authToken };
    case "header":
      return { type: "header", name: config.headerName, value: config.headerValue };
    case "oauth":
      return {
        type: "oauth",
        scope: config.scope || undefined,
        client_id: config.clientId || undefined,
        client_secret: config.clientSecret || undefined,
        client_auth: config.clientSecret ? config.clientAuth : undefined,
        client_metadata_url: config.clientMetadataUrl || undefined,
      };
    case "oauth_client_creds":
      return {
        type: "oauth_client_creds",
        token_endpoint: config.tokenEndpoint,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        scope: config.scope || undefined,
        client_auth: config.clientAuth || "post",
      };
  }
}

export function selectPrimaryLLM(state: Pick<AppState, "llmConfigs" | "primaryLLM">): LLMConfig | undefined {
  return state.llmConfigs.find((c) => c.id === state.primaryLLM);
}

// Context window for gauges: server-reported, else the primary LLM's, else the
// 128k fallback the backend also uses.
export function selectContextWindow(state: Pick<AppState, "inventory" | "llmConfigs" | "primaryLLM">): number {
  const primary = selectPrimaryLLM(state);
  return state.inventory?.contextWindow
    || primary?.contextWindow
    || (primary ? MODEL_CONTEXT[primary.model] : undefined)
    || 128_000;
}

// Request-body fields that tell the backend which LLM to use
function llmRequestFields(config: LLMConfig | null | undefined) {
  return {
    model: config?.model || undefined,
    api_key: config?.apiKey || undefined,
    provider: config?.provider || undefined,
    custom_endpoint: config?.provider === "custom" ? config.endpoint || undefined : undefined,
  };
}

// Backend session indices of the evals checked for optimization. Evals that never
// completed (no backend index) are skipped.
export function includedBackendIndices(state: Pick<AppState, "evalIncluded" | "evalResults">): number[] {
  const indices: number[] = [];
  for (const i of state.evalIncluded) {
    const backendIndex = state.evalResults[i]?.backendIndex;
    if (backendIndex !== undefined) indices.push(backendIndex);
  }
  return indices.sort((a, b) => a - b);
}

async function fetchCapabilities(set: (partial: Partial<AppState>) => void) {
  const [tools, resources, prompts, inventoryRes] = await Promise.allSettled([
    api.listTools(),
    api.listResources(),
    api.listPrompts(),
    api.getInventory(),
  ]);

  const resourceList = resources.status === "fulfilled" ? (resources.value as { resources: any[] }).resources : [];

  set({
    tools: tools.status === "fulfilled" ? (tools.value as { tools: any[] }).tools : [],
    resources: resourceList,
    prompts: prompts.status === "fulfilled" ? (prompts.value as { prompts: any[] }).prompts : [],
    inventory: inventoryRes.status === "fulfilled" ? inventoryRes.value : null,
  });

  // Auto-load all resources into the evaluation context (failed loads are skipped)
  const results = await Promise.allSettled(resourceList.map((r: any) => api.loadResource(r.uri)));
  const loaded: Array<{ uri: string; name: string; tokens: number }> = [];
  for (const res of results) {
    if (res.status === "fulfilled") {
      loaded.push({ uri: res.value.uri, name: res.value.name, tokens: res.value.tokens });
    }
  }
  set({ loadedResources: loaded });
}

// Parse a `text/event-stream` response. Event and data lines may arrive in
// different network chunks, so the pending event name lives outside the read loop.
async function readSSE(
  response: Response,
  onEvent: (event: string, data: any) => void | Promise<void>,
) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";
  let currentEvent = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const rawLine of lines) {
      const line = rawLine.replace(/\r$/, "");
      if (line.startsWith("event: ")) {
        currentEvent = line.slice(7).trim();
      } else if (line.startsWith("data: ") && currentEvent) {
        try {
          await onEvent(currentEvent, JSON.parse(line.slice(6)));
        } catch { /* skip unparseable data or handler errors */ }
        currentEvent = "";
      } else if (line === "") {
        currentEvent = "";
      }
    }
  }
}

async function consumeConnectSSE(
  response: Response,
  set: (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void,
  get: () => AppState,
) {
  await readSSE(response, async (event, data) => {
    if (event === "progress") {
      set({ connectProgress: data.message });
    } else if (event === "oauth_redirect") {
      set({ connecting: false, oauthPending: true, connectProgress: null });
      window.location.href = data.authorizationUrl;
    } else if (event === "done") {
      set({
        connected: true,
        connecting: false,
        oauthPending: false,
        serverInfo: data.serverInfo,
        connectProgress: null,
      });
      await fetchCapabilities(set);
    } else if (event === "error") {
      set({
        connecting: false,
        oauthPending: false,
        error: data.message,
        connectProgress: null,
      });
    }
  });

  if (get().connecting) {
    set({ connecting: false, connectProgress: null });
  }
}

// Migration: create config from legacy settings
function migrateToLLMConfigs(): { configs: LLMConfig[]; primaryId: string } {
  const raw = lsGet("llmConfigs");
  let configs: LLMConfig[] = [];
  try { configs = JSON.parse(raw || "[]"); } catch { /* ignore */ }
  let primaryId = lsGet("primaryLLM");

  if (configs.length === 0) {
    const oldModel = lsGet("model");
    const oldKey = lsGet("apiKey");
    const oldEndpoint = lsGet("customEndpoint");
    if (oldModel || oldKey) {
      const isCustom = !KNOWN_MODELS.some(m => m.id === oldModel);
      const config: LLMConfig = {
        id: generateId(),
        name: isCustom ? (oldModel || "Custom LLM") : KNOWN_MODELS.find(m => m.id === oldModel)?.label || oldModel || "LLM",
        provider: isCustom ? "custom" : (oldModel?.startsWith("claude-") ? "anthropic" : "openai"),
        model: oldModel || "",
        apiKey: oldKey || "",
        endpoint: oldEndpoint || "",
        contextWindow: parseInt(lsGet("customContextWindow") || "128000", 10),
      };
      configs.push(config);
      primaryId = config.id;
      lsSet("llmConfigs", JSON.stringify(configs));
      lsSet("primaryLLM", config.id);
    }
  }
  // Drop the legacy keys once migrated (older builds also mirrored the primary
  // config into them) so a deleted config can't be resurrected from them.
  if (configs.length > 0) {
    for (const key of LEGACY_LLM_KEYS) {
      try { localStorage.removeItem(LS_PREFIX + key); } catch { /* ignore */ }
    }
  }

  return { configs, primaryId };
}

function loadMCPConfigs(): MCPServerConfig[] {
  try {
    const raw = lsGet("mcpConfigs");
    let configs: MCPServerConfig[] = [];
    // Fill fields added since a config was saved so old localStorage blobs keep working.
    if (raw) configs = (JSON.parse(raw) as MCPServerConfig[]).map(
      (c) => ({ ...MCP_CONFIG_DEFAULTS, ...c })
    );

    // Migration: if no configs exist and there's exactly one URL in history, create a config
    if (configs.length === 0) {
      try {
        const historyRaw = localStorage.getItem(LS_PREFIX + "url-history");
        if (historyRaw) {
          const history = JSON.parse(historyRaw);
          if (Array.isArray(history) && history.length === 1 && typeof history[0] === "string") {
            const url = history[0];
            const config: MCPServerConfig = {
              id: generateId(),
              name: url.replace(/^https?:\/\//, "").split("/")[0] || "MCP Server",
              url,
              authMethod: "none",
              authToken: "",
              headerName: "",
              headerValue: "",
              ...MCP_CONFIG_DEFAULTS,
            };
            configs.push(config);
            lsSet("mcpConfigs", JSON.stringify(configs));
          }
        }
      } catch { /* ignore migration errors */ }
    }

    return configs;
  } catch { return []; }
}

const _migrated = migrateToLLMConfigs();

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
  oauthPending: false,
  connectProgress: null,
  llmConfigs: _migrated.configs,
  primaryLLM: _migrated.primaryId,
  analystLLM: lsGet("analystLLM"),
  mcpConfigs: loadMCPConfigs(),
  maxToolRounds: parseInt(lsGet("maxToolRounds") || "20", 10),
  maxTokensPerResponse: parseInt(lsGet("maxTokensPerResponse") || "4096", 10),
  tools: [],
  resources: [],
  prompts: [],
  inventory: null,
  selection: null,
  result: null,
  resultLoading: false,
  resultMeta: null,
  parameterStore: loadParamStore(),
  parameterAliases: loadAliases(),
  removedAliases: loadRemovedAliases(),
  loadedResources: [],
  evalResults: [],
  selectedEvalIndex: null,
  evalIncluded: new Set<number>(),
  toggleEvalIncluded: (index) => {
    set((state) => {
      const next = new Set(state.evalIncluded);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return { evalIncluded: next };
    });
  },
  evalLoading: false,
  liveContextTokens: 0,
  optimizeRunning: false,
  optimizeProgress: null,
  recommendations: [],
  quickWins: [],
  planMarkdown: "",
  optimizationRuns: [],
  selectedRunId: null,
  enabledRecIds: new Set<string>(),

  // Disabled inventory items
  disabledTools: new Set<string>(),
  disabledResources: new Set<string>(),
  disabledPrompts: new Set<string>(),

  toggleDisabledTool: (name) => {
    set((state) => {
      const next = new Set(state.disabledTools);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return { disabledTools: next };
    });
  },

  toggleDisabledResource: (uri) => {
    set((state) => {
      const next = new Set(state.disabledResources);
      if (next.has(uri)) next.delete(uri);
      else next.add(uri);
      return { disabledResources: next };
    });
  },

  toggleDisabledPrompt: (name) => {
    set((state) => {
      const next = new Set(state.disabledPrompts);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return { disabledPrompts: next };
    });
  },

  setAllToolsEnabled: (enabled) => {
    if (enabled) {
      set({ disabledTools: new Set<string>() });
    } else {
      const allNames = new Set(get().tools.map((t: any) => t.name));
      set({ disabledTools: allNames });
    }
  },

  setAllResourcesEnabled: (enabled) => {
    if (enabled) {
      set({ disabledResources: new Set<string>() });
    } else {
      const allUris = new Set(get().resources.map((r: any) => r.uri));
      set({ disabledResources: allUris });
    }
  },

  setAllPromptsEnabled: (enabled) => {
    if (enabled) {
      set({ disabledPrompts: new Set<string>() });
    } else {
      const allNames = new Set(get().prompts.map((p: any) => p.name));
      set({ disabledPrompts: allNames });
    }
  },

  toggleRecEnabled: (id) => {
    set((state) => {
      const next = new Set(state.enabledRecIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { enabledRecIds: next };
    });
  },

  setAllRecsEnabled: (enabled) => {
    if (enabled) {
      const state = get();
      const allIds = new Set<string>();
      for (const rec of state.recommendations) {
        if (rec.id) allIds.add(rec.id);
      }
      for (const qw of state.quickWins) {
        if (qw.id) allIds.add(qw.id);
      }
      set({ enabledRecIds: allIds });
    } else {
      set({ enabledRecIds: new Set<string>() });
    }
  },

  selectRun: (runId) => {
    if (runId === null) {
      set({ selectedRunId: null });
      return;
    }
    const run = get().optimizationRuns.find((r) => r.id === runId);
    if (run) {
      set({
        selectedRunId: runId,
        enabledRecIds: new Set(run.enabledRecIds),
        planMarkdown: "",
      });
      // Each run has its own plan; the global plan is only the latest run's
      fetch(`/api/results/runs/${encodeURIComponent(runId)}/plan`)
        .then((r) => (r.ok ? r.text() : ""))
        .then((text) => {
          if (get().selectedRunId === runId) set({ planMarkdown: text });
        })
        .catch(() => { /* no plan for this run */ });
    }
  },

  analyzeTools: async () => {
    try {
      const data = await api.analyzeTools();
      set({
        recommendations: data.recommendations ?? [],
        quickWins: data.quickWins ?? [],
        enabledRecIds: new Set<string>(),  // default all OFF
      });
    } catch {
      // no traces yet — that's fine
    }
  },

  runOptimizeWithSelection: async () => {
    set({ optimizeRunning: true, optimizeProgress: "Starting optimization...", planMarkdown: "" });
    try {
      const state = get();
      const analyst = llmRequestFields(state.getAnalystConfig());
      const included = includedBackendIndices(state);
      const response = await fetch("/api/optimize/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          included_indices: included,
          enabled_rec_ids: [...state.enabledRecIds],
          ...llmRequestFields(selectPrimaryLLM(state)),
          analyst_model: analyst.model,
          analyst_provider: analyst.provider,
          analyst_api_key: analyst.api_key,
          analyst_endpoint: analyst.custom_endpoint,
          disabled_tools: [...state.disabledTools],
          disabled_resources: [...state.disabledResources],
          disabled_prompts: [...state.disabledPrompts],
        }),
      });

      if (!response.ok) {
        let detail = response.statusText;
        try {
          const body = await response.text();
          const parsed = JSON.parse(body);
          detail = parsed.detail || detail;
        } catch { /* use statusText */ }
        throw new Error(detail);
      }

      await readSSE(response, async (event, data) => {
        if (event === "progress") {
          set({ optimizeProgress: data.message });
        } else if (event === "done") {
          // Fetch final results from backend
          const [recs] = await Promise.allSettled([
            api.getRecommendations(),
            get().fetchPlan(),
          ]);
          const recsData = recs.status === "fulfilled" ? recs.value as any : {};

          // Also fetch the full run data for the new run
          const runId = data.runId;
          let newRun: OptimizationRun | null = null;
          if (runId) {
            try {
              const runData = await api.getRun(runId);
              newRun = {
                id: runData.id,
                timestamp: runData.timestamp,
                name: runData.name,
                enabledRecIds: runData.enabledRecIds,
                comparison: runData.comparison,
                analystResults: runData.analystResults,
                proxyAnswers: runData.proxyAnswers,
                condensedResources: runData.condensedResources,
              };
            } catch { /* ignore */ }
          }

          const updatedRuns = newRun
            ? [...get().optimizationRuns.filter((r) => r.id !== newRun!.id), newRun]
            : get().optimizationRuns;

          set({
            optimizeRunning: false,
            optimizeProgress: null,
            recommendations: recsData?.recommendations ?? [],
            quickWins: recsData?.quickWins ?? [],
            optimizationRuns: updatedRuns,
            selectedRunId: runId || null,
          });
        } else if (event === "error") {
          set({ optimizeRunning: false, optimizeProgress: null, error: data.message });
        }
      });

      if (get().optimizeRunning) {
        set({ optimizeRunning: false, optimizeProgress: null });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      set({ optimizeRunning: false, optimizeProgress: null, error: message });
    }
  },

  fetchRecommendations: async () => {
    try {
      const data = await api.getRecommendations() as { recommendations: any[]; quickWins: any[] };
      set({ recommendations: data.recommendations, quickWins: data.quickWins ?? [] });
    } catch {
      // no recommendations yet
    }
  },

  fetchPlan: async () => {
    try {
      const res = await fetch("/api/results/plan");
      if (res.ok) {
        const text = await res.text();
        set({ planMarkdown: text });
      }
    } catch {
      // no plan yet
    }
  },

  checkStatus: async () => {
    // Already connected: refetching would reload every resource and undo user unloads
    if (get().connected) return;
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

  addLLMConfig: (config) => {
    const configs = [...get().llmConfigs, config];
    lsSet("llmConfigs", JSON.stringify(configs));
    set({ llmConfigs: configs });
  },

  updateLLMConfig: (id, updates) => {
    const configs = get().llmConfigs.map((c) => c.id === id ? { ...c, ...updates } : c);
    lsSet("llmConfigs", JSON.stringify(configs));
    set({ llmConfigs: configs });
  },

  removeLLMConfig: (id) => {
    const configs = get().llmConfigs.filter((c) => c.id !== id);
    lsSet("llmConfigs", JSON.stringify(configs));
    const updates: Partial<AppState> = { llmConfigs: configs };
    if (get().primaryLLM === id) {
      updates.primaryLLM = "";
      lsSet("primaryLLM", "");
    }
    if (get().analystLLM === id) {
      updates.analystLLM = "";
      lsSet("analystLLM", "");
    }
    set(updates);
  },

  setPrimaryLLM: (id) => {
    lsSet("primaryLLM", id);
    set({ primaryLLM: id });
  },

  setAnalystLLM: (id) => {
    lsSet("analystLLM", id);
    set({ analystLLM: id });
  },

  addMCPConfig: (config) => {
    const configs = [...get().mcpConfigs, config];
    lsSet("mcpConfigs", JSON.stringify(configs));
    set({ mcpConfigs: configs });
  },

  updateMCPConfig: (id, updates) => {
    const configs = get().mcpConfigs.map((c) => c.id === id ? { ...c, ...updates } : c);
    lsSet("mcpConfigs", JSON.stringify(configs));
    set({ mcpConfigs: configs });
  },

  removeMCPConfig: (id) => {
    const configs = get().mcpConfigs.filter((c) => c.id !== id);
    lsSet("mcpConfigs", JSON.stringify(configs));
    set({ mcpConfigs: configs });
  },

  getAnalystConfig: () => {
    const { analystLLM, llmConfigs } = get();
    return llmConfigs.find((c) => c.id === analystLLM) || null;
  },

  setMaxToolRounds: (n) => {
    lsSet("maxToolRounds", String(n));
    set({ maxToolRounds: n });
  },

  setMaxTokensPerResponse: (n) => {
    lsSet("maxTokensPerResponse", String(n));
    set({ maxTokensPerResponse: n });
  },

  connect: async (config: MCPServerConfig) => {
    set({ connecting: true, error: null, oauthPending: false, connectProgress: null });
    try {
      const state = get();
      const authConfig = buildAuthConfig(config);
      const primaryConfig = selectPrimaryLLM(state);
      const llm = llmRequestFields(primaryConfig);
      const res = await api.connect(
        config.url, authConfig,
        llm.model,
        llm.provider,
        llm.api_key,
        llm.custom_endpoint,
        primaryConfig?.contextWindow,
        config.protocol,
      );

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
      const response = await fetch("/api/auth/callback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callback_url: callbackUrl,
          ...llmRequestFields(selectPrimaryLLM(get())),
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
      prompts: [],
      inventory: null,
      selection: null,
      result: null,
      parameterStore: {},
      resultMeta: null,
      loadedResources: [],
      liveContextTokens: 0,
      evalResults: [],
      selectedEvalIndex: null,
      evalIncluded: new Set<number>(),
      evalLoading: false,
      optimizeRunning: false,
      optimizeProgress: null,
      recommendations: [],
      quickWins: [],
      planMarkdown: "",
      optimizationRuns: [],
      selectedRunId: null,
      enabledRecIds: new Set<string>(),
      disabledTools: new Set<string>(),
      disabledResources: new Set<string>(),
      disabledPrompts: new Set<string>(),
    });
  },

  signOutMCP: async (url: string) => {
    if (get().connected) {
      await get().disconnect();
    }
    try {
      await api.signOut(url);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      set({ error: `Sign-out failed: ${message}` });
    }
  },

  select: (type, item) => set({ selection: { type, item }, result: null }),
  clearSelection: () => set({ selection: null, result: null }),

  callTool: async (name, args) => {
    set({ resultLoading: true, result: null, resultMeta: null });
    const start = performance.now();
    try {
      const result = await api.callTool(name, args);
      const durationMs = Math.round(performance.now() - start);
      // Estimate tokens from response content
      let tokens = 0;
      const content = (result as any)?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block?.text) tokens += estimateTokens(block.text);
        }
      }
      set({ result, resultLoading: false, resultMeta: { durationMs, tokens } });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      set({ result: { error: message }, resultLoading: false, resultMeta: null });
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

  // Resource loading
  toggleResource: async (uri) => {
    const isLoaded = get().loadedResources.some((r) => r.uri === uri);
    try {
      if (isLoaded) {
        await api.unloadResource(uri);
        set((state) => ({
          loadedResources: state.loadedResources.filter((r) => r.uri !== uri),
        }));
      } else {
        const result = await api.loadResource(uri);
        set((state) => ({
          loadedResources: [...state.loadedResources, { uri: result.uri, name: result.name, tokens: result.tokens }],
        }));
      }
    } catch { /* ignore */ }
  },

  // Optimize actions
  evaluate: async (prompt) => {
    // Add a placeholder entry immediately and select it
    const placeholderIndex = get().evalResults.length;
    set((state) => ({
      evalLoading: true,
      liveContextTokens: 0,
      evalResults: [
        ...state.evalResults,
        { prompt, answer: "", toolChain: [], traceEvents: [] },
      ],
      selectedEvalIndex: placeholderIndex,
    }));

    try {
      const state = get();
      const response = await fetch("/api/optimize/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          ...llmRequestFields(selectPrimaryLLM(state)),
          max_tool_rounds: state.maxToolRounds || undefined,
          max_tokens: state.maxTokensPerResponse || undefined,
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ detail: response.statusText }));
        throw new Error(err.detail || response.statusText);
      }

      await readSSE(response, (event, data) => {
        // Update live context tokens
        if (event === "context_update" && data.context_tokens != null) {
          // API-reported value is authoritative — allow corrections downward
          set({ liveContextTokens: data.context_tokens });
        } else if (data.context_tokens != null && data.context_tokens > get().liveContextTokens) {
          // Estimates only go up (monotonic) to avoid visual jitter
          set({ liveContextTokens: data.context_tokens });
        }

        if (event === "text_delta") {
          // Streaming text from LLM — append to current answer
          set((state) => {
            const evalResults = [...state.evalResults];
            const entry = { ...evalResults[placeholderIndex] };
            entry.answer = (entry.answer || "") + (data.text || "");
            evalResults[placeholderIndex] = entry;
            return { evalResults };
          });
        } else if (event === "tool_calling") {
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
        } else if (event === "tool_result") {
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
        } else if (event === "done") {
          // Final result
          set((state) => {
            const evalResults = [...state.evalResults];
            evalResults[placeholderIndex] = {
              prompt: data.prompt,
              answer: data.answer,
              toolChain: data.toolChain,
              traceEvents: data.traceEvents,
              usage: data.usage,
              backendIndex: data.index,
            };
            // Auto-include in optimization
            const included = new Set(state.evalIncluded);
            included.add(placeholderIndex);
            return { evalResults, evalLoading: false, evalIncluded: included };
          });
        } else if (event === "error") {
          set((state) => {
            const evalResults = [...state.evalResults];
            evalResults[placeholderIndex] = {
              ...evalResults[placeholderIndex],
              answer: `Error: ${data.message}`,
            };
            return { evalResults, evalLoading: false };
          });
        }
      });

      // Ensure loading is cleared — also auto-include if we got an answer
      set((state) => {
        const ev = state.evalResults[placeholderIndex];
        if (ev?.answer && !ev.answer.startsWith("Error:")) {
          const included = new Set(state.evalIncluded);
          included.add(placeholderIndex);
          return { evalLoading: false, evalIncluded: included };
        }
        return { evalLoading: false };
      });
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

  removeEval: (index) => {
    // evaluate() writes to its entry by position while streaming
    if (get().evalLoading) return;
    set((state) => {
      const evalResults = state.evalResults.filter((_, i) => i !== index);
      // Rebuild evalIncluded with shifted indices
      const included = new Set<number>();
      for (const i of state.evalIncluded) {
        if (i < index) included.add(i);
        else if (i > index) included.add(i - 1);
        // i === index is the removed one, skip
      }
      // Adjust selectedEvalIndex
      let selectedEvalIndex = state.selectedEvalIndex;
      if (selectedEvalIndex !== null) {
        if (selectedEvalIndex === index) selectedEvalIndex = null;
        else if (selectedEvalIndex > index) selectedEvalIndex--;
      }
      return { evalResults, evalIncluded: included, selectedEvalIndex };
    });
  },

  selectEval: (index) => set({ selectedEvalIndex: index }),
}));
