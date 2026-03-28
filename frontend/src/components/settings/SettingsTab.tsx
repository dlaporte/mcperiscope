import { useState } from "react";
import { useStore, KNOWN_MODELS } from "../../store";
import type { LLMConfig, MCPServerConfig } from "../../store";


const PROVIDER_LABELS: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  custom: "Custom",
};

function formatContext(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`;
}

function LLMConfigCard({ config }: { config: LLMConfig }) {
  const { updateLLMConfig, removeLLMConfig } = useStore();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [name, setName] = useState(config.name);
  const [provider, setProvider] = useState(config.provider);
  const [model, setModel] = useState(config.model);
  const [apiKey, setApiKey] = useState(config.apiKey);
  const [endpoint, setEndpoint] = useState(config.endpoint);
  const [contextWindow, setContextWindow] = useState(config.contextWindow);

  const handleSave = () => {
    updateLLMConfig(config.id, { name, provider, model, apiKey, endpoint, contextWindow });
    setEditing(false);
  };

  const handleCancel = () => {
    setName(config.name);
    setProvider(config.provider);
    setModel(config.model);
    setApiKey(config.apiKey);
    setEndpoint(config.endpoint);
    setContextWindow(config.contextWindow);
    setEditing(false);
  };

  const handleProviderChange = (newProvider: "anthropic" | "openai" | "custom") => {
    setProvider(newProvider);
    if (newProvider !== "custom") {
      const firstModel = KNOWN_MODELS.find((m) => m.provider === newProvider);
      if (firstModel) {
        setModel(firstModel.id);
        setContextWindow(firstModel.context);
      }
      setEndpoint("");
    } else {
      setModel("");
      setEndpoint("");
      setContextWindow(128000);
    }
  };

  const handleModelSelect = (modelId: string) => {
    setModel(modelId);
    const known = KNOWN_MODELS.find((m) => m.id === modelId);
    if (known) {
      setContextWindow(known.context);
    }
  };

  return (
    <div className="panel-riveted rounded-lg p-4">
      <div className="flex items-center justify-between">
        <span className="font-medium" style={{ color: "var(--sub-text)" }}>{config.name}</span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setEditing(!editing)}
            className="text-xs px-2 py-1 rounded transition-colors"
            style={{ color: "var(--sub-brass)", backgroundColor: "rgba(196,154,42,0.1)" }}
          >
            {editing ? "Cancel" : "Edit"}
          </button>
          {!confirmDelete ? (
            <button
              onClick={() => setConfirmDelete(true)}
              className="text-xs px-2 py-1 rounded transition-colors"
              style={{ color: "var(--sub-red)", backgroundColor: "rgba(204,51,51,0.1)" }}
            >
              Delete
            </button>
          ) : (
            <div className="flex items-center gap-1">
              <button
                onClick={() => removeLLMConfig(config.id)}
                className="text-xs px-2 py-1 rounded font-medium"
                style={{ color: "#fff", backgroundColor: "var(--sub-red)" }}
              >
                Confirm
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="text-xs px-2 py-1 rounded"
                style={{ color: "var(--sub-text-dim)" }}
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>

      {editing && (
        <div className="mt-4 space-y-3 pt-3" style={{ borderTop: "1px solid var(--sub-rivet)" }}>
          {/* Name */}
          <div>
            <label className="block text-xs mb-1" style={{ color: "var(--sub-text-dim)" }}>Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full input-sub border rounded-lg px-3 py-2 text-sm"
              placeholder="e.g. Claude Sonnet"
            />
          </div>

          {/* Provider */}
          <div>
            <label className="block text-xs mb-1" style={{ color: "var(--sub-text-dim)" }}>Provider</label>
            <div className="flex gap-2">
              {(["anthropic", "openai", "custom"] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => handleProviderChange(p)}
                  className="px-3 py-1.5 text-sm rounded-lg border transition-colors"
                  style={
                    provider === p
                      ? { borderColor: "var(--sub-brass)", color: "var(--sub-brass)", backgroundColor: "rgba(196,154,42,0.1)" }
                      : { borderColor: "var(--sub-rivet)", color: "var(--sub-text-dim)", backgroundColor: "transparent" }
                  }
                >
                  {PROVIDER_LABELS[p]}
                </button>
              ))}
            </div>
          </div>

          {/* Model */}
          <div>
            <label className="block text-xs mb-1" style={{ color: "var(--sub-text-dim)" }}>Model</label>
            {provider === "custom" ? (
              <input
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full input-sub border rounded-lg px-3 py-2 text-sm"
                placeholder="e.g. deepseek-chat"
              />
            ) : (
              <select
                value={model}
                onChange={(e) => handleModelSelect(e.target.value)}
                className="w-full input-sub border rounded-lg px-2 py-2 text-sm"
              >
                {KNOWN_MODELS.filter((m) => m.provider === provider).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label} ({formatContext(m.context)} ctx)
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* API Key */}
          <div>
            <label className="block text-xs mb-1" style={{ color: "var(--sub-text-dim)" }}>API Key</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="w-full input-sub border rounded-lg px-3 py-2 text-sm"
              placeholder="API key"
            />
          </div>

          {/* Endpoint (custom only) */}
          {provider === "custom" && (
            <div>
              <label className="block text-xs mb-1" style={{ color: "var(--sub-text-dim)" }}>Endpoint URL</label>
              <input
                type="text"
                value={endpoint}
                onChange={(e) => setEndpoint(e.target.value)}
                className="w-full input-sub border rounded-lg px-3 py-2 text-sm"
                placeholder="e.g. https://api.deepseek.com/v1"
              />
            </div>
          )}

          {/* Context Window (custom only) */}
          {provider === "custom" && (
            <div>
              <label className="block text-xs mb-1" style={{ color: "var(--sub-text-dim)" }}>Context Window</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={contextWindow}
                  onChange={(e) => setContextWindow(parseInt(e.target.value, 10) || 128000)}
                  className="w-40 input-sub border rounded-lg px-3 py-2 text-sm"
                />
                <span className="text-xs" style={{ color: "var(--sub-text-dim)" }}>tokens</span>
              </div>
            </div>
          )}

          {/* Save / Cancel */}
          <div className="flex gap-2 pt-1">
            <button
              onClick={handleSave}
              className="btn-brass px-4 py-1.5 rounded-lg text-sm font-medium"
            >
              Save
            </button>
            <button
              onClick={handleCancel}
              className="px-4 py-1.5 rounded-lg text-sm"
              style={{ color: "var(--sub-text-dim)", border: "1px solid var(--sub-rivet)" }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function MCPConfigCard({ config }: { config: MCPServerConfig }) {
  const { updateMCPConfig, removeMCPConfig } = useStore();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [name, setName] = useState(config.name);
  const [url, setUrl] = useState(config.url);
  const [authMethod, setAuthMethod] = useState(config.authMethod);
  const [authToken, setAuthToken] = useState(config.authToken);
  const [headerName, setHeaderName] = useState(config.headerName);
  const [headerValue, setHeaderValue] = useState(config.headerValue);

  const handleSave = () => {
    updateMCPConfig(config.id, { name, url, authMethod, authToken, headerName, headerValue });
    setEditing(false);
  };

  const handleCancel = () => {
    setName(config.name);
    setUrl(config.url);
    setAuthMethod(config.authMethod);
    setAuthToken(config.authToken);
    setHeaderName(config.headerName);
    setHeaderValue(config.headerValue);
    setEditing(false);
  };

  return (
    <div className="panel-riveted rounded-lg p-4">
      <div className="flex items-center justify-between">
        <span className="font-medium" style={{ color: "var(--sub-text)" }}>{config.name}</span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setEditing(!editing)}
            className="text-xs px-2 py-1 rounded transition-colors"
            style={{ color: "var(--sub-brass)", backgroundColor: "rgba(196,154,42,0.1)" }}
          >
            {editing ? "Cancel" : "Edit"}
          </button>
          {!confirmDelete ? (
            <button
              onClick={() => setConfirmDelete(true)}
              className="text-xs px-2 py-1 rounded transition-colors"
              style={{ color: "var(--sub-red)", backgroundColor: "rgba(204,51,51,0.1)" }}
            >
              Delete
            </button>
          ) : (
            <div className="flex items-center gap-1">
              <button
                onClick={() => removeMCPConfig(config.id)}
                className="text-xs px-2 py-1 rounded font-medium"
                style={{ color: "#fff", backgroundColor: "var(--sub-red)" }}
              >
                Confirm
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="text-xs px-2 py-1 rounded"
                style={{ color: "var(--sub-text-dim)" }}
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>

      {editing && (
        <div className="mt-4 space-y-3 pt-3" style={{ borderTop: "1px solid var(--sub-rivet)" }}>
          {/* Name */}
          <div>
            <label className="block text-xs mb-1" style={{ color: "var(--sub-text-dim)" }}>Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full input-sub border rounded-lg px-3 py-2 text-sm"
              placeholder="e.g. Scoutbook MCP"
            />
          </div>

          {/* URL */}
          <div>
            <label className="block text-xs mb-1" style={{ color: "var(--sub-text-dim)" }}>URL</label>
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="w-full input-sub border rounded-lg px-3 py-2 text-sm"
              placeholder="https://example.com/mcp"
            />
          </div>

          {/* Auth Method */}
          <div>
            <label className="block text-xs mb-1" style={{ color: "var(--sub-text-dim)" }}>Auth Method</label>
            <select
              value={authMethod}
              onChange={(e) => setAuthMethod(e.target.value as MCPServerConfig["authMethod"])}
              className="w-full input-sub border rounded-lg px-2 py-2 text-sm"
            >
              <option value="none">None</option>
              <option value="bearer">Bearer Token</option>
              <option value="header">Custom Header</option>
              <option value="oauth">OAuth 2.0</option>
            </select>
          </div>

          {/* Bearer Token */}
          {authMethod === "bearer" && (
            <div>
              <label className="block text-xs mb-1" style={{ color: "var(--sub-text-dim)" }}>Token</label>
              <input
                type="password"
                value={authToken}
                onChange={(e) => setAuthToken(e.target.value)}
                className="w-full input-sub border rounded-lg px-3 py-2 text-sm"
                placeholder="Bearer token"
              />
            </div>
          )}

          {/* Custom Header */}
          {authMethod === "header" && (
            <>
              <div>
                <label className="block text-xs mb-1" style={{ color: "var(--sub-text-dim)" }}>Header Name</label>
                <input
                  type="text"
                  value={headerName}
                  onChange={(e) => setHeaderName(e.target.value)}
                  className="w-full input-sub border rounded-lg px-3 py-2 text-sm"
                  placeholder="X-API-Key"
                />
              </div>
              <div>
                <label className="block text-xs mb-1" style={{ color: "var(--sub-text-dim)" }}>Header Value</label>
                <input
                  type="password"
                  value={headerValue}
                  onChange={(e) => setHeaderValue(e.target.value)}
                  className="w-full input-sub border rounded-lg px-3 py-2 text-sm"
                  placeholder="Header value"
                />
              </div>
            </>
          )}

          {/* OAuth note */}
          {authMethod === "oauth" && (
            <p className="text-xs" style={{ color: "var(--sub-text-dim)" }}>
              OAuth flow will be initiated on connect.
            </p>
          )}

          {/* Save / Cancel */}
          <div className="flex gap-2 pt-1">
            <button
              onClick={handleSave}
              className="btn-brass px-4 py-1.5 rounded-lg text-sm font-medium"
            >
              Save
            </button>
            <button
              onClick={handleCancel}
              className="px-4 py-1.5 rounded-lg text-sm"
              style={{ color: "var(--sub-text-dim)", border: "1px solid var(--sub-rivet)" }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function SettingsTab() {
  const {
    llmConfigs,
    primaryLLM,
    analystLLM,
    addLLMConfig,
    setPrimaryLLM,
    setAnalystLLM,
    maxToolRounds,
    maxTokensPerResponse,
    setMaxToolRounds,
    setMaxTokensPerResponse,
    mcpConfigs,
    addMCPConfig,
  } = useStore();

  const handleAddLLM = () => {
    const config: LLMConfig = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
      name: "New LLM",
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      apiKey: "",
      endpoint: "",
      contextWindow: 1000000,
    };
    addLLMConfig(config);
  };

  const handleAddMCP = () => {
    const config: MCPServerConfig = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
      name: "New Server",
      url: "",
      authMethod: "none",
      authToken: "",
      headerName: "",
      headerValue: "",
    };
    addMCPConfig(config);
  };

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-2xl mx-auto space-y-8">
        {/* MCP Servers */}
        <section>
          <h2 className="font-stencil text-sm font-bold mb-4" style={{ color: "var(--sub-brass)" }}>
            MCP Servers
          </h2>
          <div className="space-y-3">
            {mcpConfigs.map((config) => (
              <MCPConfigCard key={config.id} config={config} />
            ))}
            {mcpConfigs.length === 0 && (
              <p className="text-sm" style={{ color: "var(--sub-text-dim)" }}>
                No MCP server configurations yet. Add one to get started.
              </p>
            )}
          </div>
          <button
            onClick={handleAddMCP}
            className="mt-3 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            style={{
              border: "1px dashed var(--sub-brass-dim)",
              color: "var(--sub-brass)",
              backgroundColor: "rgba(196,154,42,0.05)",
            }}
          >
            + Add Server
          </button>
        </section>

        {/* LLM Configurations */}
        <section>
          <h2 className="font-stencil text-sm font-bold mb-4" style={{ color: "var(--sub-brass)" }}>
            LLM Configurations
          </h2>
          <div className="space-y-3">
            {llmConfigs.map((config) => (
              <LLMConfigCard key={config.id} config={config} />
            ))}
            {llmConfigs.length === 0 && (
              <p className="text-sm" style={{ color: "var(--sub-text-dim)" }}>
                No LLM configurations yet. Add one to get started.
              </p>
            )}
          </div>
          <button
            onClick={handleAddLLM}
            className="mt-3 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            style={{
              border: "1px dashed var(--sub-brass-dim)",
              color: "var(--sub-brass)",
              backgroundColor: "rgba(196,154,42,0.05)",
            }}
          >
            + Add LLM
          </button>
        </section>

        {/* Role Assignment */}
        <section>
          <h2 className="font-stencil text-sm font-bold mb-4" style={{ color: "var(--sub-brass)" }}>
            Role Assignment
          </h2>
          <div className="panel-riveted rounded-lg p-4 space-y-4">
            <div>
              <label className="block text-xs mb-1" style={{ color: "var(--sub-text-dim)" }}>
                Agent LLM
                <span className="ml-2 text-[10px]" style={{ color: "var(--sub-text-dim)" }}>
                  Executes evaluation prompts using MCP tools to answer questions
                </span>
              </label>
              <select
                value={primaryLLM}
                onChange={(e) => setPrimaryLLM(e.target.value)}
                className="w-full input-sub border rounded-lg px-2 py-2 text-sm"
              >
                <option value="">-- Select --</option>
                {llmConfigs.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.model})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs mb-1" style={{ color: "var(--sub-text-dim)" }}>
                Analyst LLM
                <span className="ml-2 text-[10px]" style={{ color: "var(--sub-text-dim)" }}>
                  Compares baseline vs optimized answers and generates proxy server code
                </span>
              </label>
              <select
                value={analystLLM}
                onChange={(e) => setAnalystLLM(e.target.value)}
                className="w-full input-sub border rounded-lg px-2 py-2 text-sm"
              >
                <option value="">-- Same as Agent --</option>
                {llmConfigs.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.model})
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>

        {/* Evaluation Settings */}
        <section>
          <h2 className="font-stencil text-sm font-bold mb-4" style={{ color: "var(--sub-brass)" }}>
            Evaluation
          </h2>
          <div className="panel-riveted rounded-lg p-4 space-y-4">
            <div>
              <label className="block text-xs mb-1" style={{ color: "var(--sub-text-dim)" }}>
                Max tool call rounds
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={maxToolRounds}
                  onChange={(e) => setMaxToolRounds(parseInt(e.target.value, 10) || 20)}
                  min={1}
                  max={100}
                  className="w-24 input-sub border rounded-lg px-3 py-2 text-sm"
                />
                <span className="text-xs" style={{ color: "var(--sub-text-dim)" }}>
                  rounds per evaluation (default: 20)
                </span>
              </div>
            </div>
            <div>
              <label className="block text-xs mb-1" style={{ color: "var(--sub-text-dim)" }}>
                Max tokens per response
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={maxTokensPerResponse}
                  onChange={(e) => setMaxTokensPerResponse(parseInt(e.target.value, 10) || 4096)}
                  min={256}
                  max={32768}
                  step={256}
                  className="w-24 input-sub border rounded-lg px-3 py-2 text-sm"
                />
                <span className="text-xs" style={{ color: "var(--sub-text-dim)" }}>
                  tokens (default: 4096)
                </span>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
