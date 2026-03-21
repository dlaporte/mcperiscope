import { useState, useEffect } from "react";
import { useStore } from "../../store";
import { ContextGauge } from "./ContextGauge";

interface InventoryData {
  tool_count: number;
  total_budget_tokens: number;
  tool_tokens?: number;
  resource_tokens?: number;
  prompt_tokens?: number;
  context_window: number;
  context_pct: number;
  model: string;
}

const MODEL_CONTEXT: Record<string, number> = {
  "claude-opus-4-6": 1_000_000,
  "claude-sonnet-4-6": 1_000_000,
  "claude-haiku-4-5-20251001": 200_000,
  "gpt-5.4": 1_000_000,
  "gpt-5.4-mini": 400_000,
  "gpt-5.2": 400_000,
  "gpt-4o": 128_000,
  "gpt-4o-mini": 128_000,
};

export function InventoryBar() {
  const { tools, model, customContextWindow } = useStore();
  const [inventory, setInventory] = useState<InventoryData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (tools.length === 0) {
      setInventory(null);
      return;
    }
    let cancelled = false;
    setLoading(true);

    fetch("/api/analysis/inventory")
      .then(async (res) => {
        if (!res.ok) throw new Error("Failed to fetch inventory");
        return res.json();
      })
      .then((data) => {
        if (!cancelled) setInventory(data);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [tools.length]);

  const totalTokens = inventory?.total_budget_tokens ?? 0;
  const contextWindow = inventory?.context_window ?? MODEL_CONTEXT[model] ?? customContextWindow ?? 200_000;

  return (
    <div
      className="relative flex items-center gap-4 px-4 py-2 text-sm"
      style={{ backgroundColor: 'var(--sub-panel)', borderBottom: '1px solid var(--sub-rivet)' }}
    >
      <span className="font-stencil text-xs whitespace-nowrap" style={{ color: 'var(--sub-text-dim)' }}>Session usage</span>
      {!loading && inventory && (
        <div className="flex-1 min-w-0">
          <ContextGauge tokens={totalTokens} max={contextWindow} />
        </div>
      )}
      {loading && (
        <div className="flex-1 text-xs animate-pulse" style={{ color: 'var(--sub-text-dim)' }}>
          Calculating token budget...
        </div>
      )}
    </div>
  );
}
