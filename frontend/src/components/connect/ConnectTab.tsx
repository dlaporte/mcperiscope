import { useState, useEffect } from "react";
import { useStore } from "../../store";

function LLMDisplay() {
  const { llmConfigs, primaryLLM, analystLLM, setActiveTab } = useStore();
  const agentConfig = llmConfigs.find((c) => c.id === primaryLLM);
  const analystConfig = analystLLM ? llmConfigs.find((c) => c.id === analystLLM) : agentConfig;

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-sm" style={{ color: 'var(--sub-text-dim)' }}>LLM Configuration</label>
        <button
          type="button"
          onClick={() => setActiveTab("settings")}
          className="text-xs px-2 py-0.5 rounded"
          style={{ color: 'var(--sub-brass)', backgroundColor: 'rgba(196,154,42,0.1)' }}
        >
          Settings
        </button>
      </div>
      <div className="space-y-1.5">
        <div
          className="rounded-lg px-3 py-2 text-sm flex items-center justify-between"
          style={{ backgroundColor: 'var(--sub-hull)', border: '1px solid var(--sub-rivet)' }}
        >
          <span className="text-xs" style={{ color: 'var(--sub-text-dim)' }}>Agent</span>
          {agentConfig ? (
            <span style={{ color: 'var(--sub-text)' }}>{agentConfig.name}</span>
          ) : (
            <span style={{ color: 'var(--sub-text-dim)' }}>Not configured</span>
          )}
        </div>
        <div
          className="rounded-lg px-3 py-2 text-sm flex items-center justify-between"
          style={{ backgroundColor: 'var(--sub-hull)', border: '1px solid var(--sub-rivet)' }}
        >
          <span className="text-xs" style={{ color: 'var(--sub-text-dim)' }}>Analyst</span>
          {analystConfig ? (
            <span style={{ color: 'var(--sub-text)' }}>{analystConfig.name}</span>
          ) : (
            <span style={{ color: 'var(--sub-text-dim)' }}>Not configured</span>
          )}
        </div>
      </div>
    </div>
  );
}

export function ConnectTab() {
  const {
    connected, connecting, error, connect, disconnect, oauthPending,
    connectProgress,
    mcpConfigs, selectMCPConfig, setActiveTab,
    checkStatus,
  } = useStore();

  const { completeOAuth } = useStore();

  const [selectedConfigId, setSelectedConfigId] = useState<string>(() => {
    return mcpConfigs.length > 0 ? mcpConfigs[0].id : "";
  });

  const selectedConfig = mcpConfigs.find((c) => c.id === selectedConfigId);

  // Check backend status on mount, and resume pending OAuth if needed
  useEffect(() => {
    checkStatus();
    const pendingCallback = sessionStorage.getItem("mcperiscope:pending-oauth-callback");
    if (pendingCallback) {
      sessionStorage.removeItem("mcperiscope:pending-oauth-callback");
      completeOAuth(pendingCallback);
    }
  }, [checkStatus, completeOAuth]);

  const handleConfigSelect = (configId: string) => {
    setSelectedConfigId(configId);
    selectMCPConfig(configId);
  };

  const handleConnect = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedConfig) {
      connect(selectedConfig.url);
    }
  };

  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="w-full max-w-xl">
        <div className="panel-riveted rounded-xl p-6 shadow-lg">
          <div className="flex items-center gap-3 mb-6">
            <div
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: connected ? 'var(--sub-phosphor)' : 'var(--sub-text-dim)', boxShadow: connected ? '0 0 6px var(--sub-phosphor)' : 'none' }}
            />
            <h2 className="text-lg font-semibold font-stencil" style={{ color: 'var(--sub-text)' }}>
              {connected ? "Connected" : "Connect to MCP Server"}
            </h2>
          </div>

          <form onSubmit={handleConnect} className="space-y-4">
            {/* Server Selection */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm" style={{ color: 'var(--sub-text-dim)' }}>MCP Server</label>
                <button
                  type="button"
                  onClick={() => setActiveTab("settings")}
                  className="text-xs px-2 py-0.5 rounded"
                  style={{ color: 'var(--sub-brass)', backgroundColor: 'rgba(196,154,42,0.1)' }}
                >
                  Settings
                </button>
              </div>
              {mcpConfigs.length > 0 ? (
                <select
                  value={selectedConfigId}
                  onChange={(e) => handleConfigSelect(e.target.value)}
                  disabled={connected || connecting}
                  className="w-full input-sub border rounded-lg px-2 py-2 text-sm disabled:opacity-50"
                >
                  {mcpConfigs.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              ) : (
                <div
                  className="w-full rounded-lg px-3 py-2 text-sm"
                  style={{ backgroundColor: 'var(--sub-hull)', border: '1px solid var(--sub-rivet)', color: 'var(--sub-text-dim)' }}
                >
                  No servers configured. Add one in Settings.
                </div>
              )}
            </div>

            {/* LLM Info */}
            <LLMDisplay />

            {/* Connect / Disconnect Button */}
            <div className="pt-2">
              {connected ? (
                <button
                  type="button"
                  onClick={disconnect}
                  className="w-full px-4 py-2.5 rounded-lg text-sm font-medium text-white"
                  style={{ backgroundColor: 'var(--sub-red)' }}
                >
                  Disconnect
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={connecting || !selectedConfig}
                  className="btn-brass w-full px-4 py-2.5 rounded-lg text-sm font-medium disabled:opacity-50"
                >
                  {connecting ? "Connecting..." : oauthPending ? "Redirecting..." : "Connect"}
                </button>
              )}
            </div>
          </form>

          {/* Error Display */}
          {error && (
            <p className="alarm-text text-sm mt-4">{error}</p>
          )}

          {/* Connection Progress */}
          {connecting && connectProgress && (
            <div className="mt-4 p-3 rounded-lg flex items-center gap-3" style={{ backgroundColor: 'var(--sub-hull)' }}>
              <div className="w-4 h-4 border-2 rounded-full animate-spin flex-shrink-0" style={{ borderColor: 'var(--sub-brass)', borderTopColor: 'transparent' }} />
              <span className="text-sm" style={{ color: 'var(--sub-text-dim)' }}>{connectProgress}</span>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
