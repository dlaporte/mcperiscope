import { useState, useEffect } from "react";
import { useStore } from "../../store";
import { MODEL_CONTEXT } from "../../config/models";
import { ContextGauge } from "./ContextGauge";

interface InventoryData {
  tool_count: number;
  totalBudgetTokens: number;
  toolTokens?: number;
  resourceTokens?: number;
  promptTokens?: number;
  contextWindow: number;
  contextPct: number;
  model: string;
}

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

  const totalTokens = inventory?.totalBudgetTokens ?? 0;
  const contextWindow = inventory?.contextWindow ?? MODEL_CONTEXT[model] ?? customContextWindow ?? 200_000;

  return (
    <div
      className="flex items-center gap-4 px-4 py-3"
      style={{ backgroundColor: 'var(--sub-panel)', borderBottom: '1px solid var(--sub-rivet)' }}
    >
      <span className="font-stencil text-xs whitespace-nowrap" style={{ color: 'var(--sub-text-dim)' }}>Session usage</span>
      {!loading && inventory && (
        <ContextGauge tokens={totalTokens} max={contextWindow} />
      )}
      {loading && (
        <div className="flex-1 text-xs animate-pulse" style={{ color: 'var(--sub-text-dim)' }}>
          Calculating token budget...
        </div>
      )}
    </div>
  );
}
