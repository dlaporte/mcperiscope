import { useState, useEffect } from "react";
import { useStore } from "../../store";
import { ContextBudget } from "./ContextBudget";

interface InventoryData {
  tool_count: number;
  total_budget_tokens: number;
  context_window: number;
  context_pct: number;
  model: string;
  quick_wins?: { type: string; description: string; tools: string[] }[];
}


export function InventoryBar() {
  const { tools, model } = useStore();
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
      .catch(() => {
        // silently fail — inventory is supplementary
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [tools.length]);

  const toolCount = tools.length;
  const totalTokens = inventory?.total_budget_tokens ?? 0;
  const contextWindow = inventory?.context_window ?? 200000;
  const quickWins = Array.isArray(inventory?.quick_wins) ? inventory.quick_wins.length : 0;

  return (
    <div className="flex items-center gap-4 px-4 py-2 bg-gray-800/50 border-b border-gray-700 text-sm">
      {/* Tool count */}
      <div className="flex items-center gap-1.5">
        <span className="bg-blue-500/20 text-blue-400 text-xs font-bold px-2 py-0.5 rounded-full">
          {toolCount}
        </span>
        <span className="text-gray-400">tools</span>
      </div>

      {/* Context budget */}
      {!loading && inventory && (
        <div className="flex-1 min-w-0">
          <ContextBudget tokens={totalTokens} max={contextWindow} />
        </div>
      )}
      {loading && (
        <div className="flex-1 text-xs text-gray-500 animate-pulse">
          Calculating token budget...
        </div>
      )}

      {/* Model label (configured on Connect tab) */}
      <span className="text-xs text-gray-500">
        {model.replace(/-\d{8}$/, "")}
      </span>

      {/* Quick wins */}
      {quickWins > 0 && (
        <div className="flex items-center gap-1.5">
          <span className="bg-green-500/20 text-green-400 text-xs font-bold px-2 py-0.5 rounded-full">
            {quickWins}
          </span>
          <span className="text-gray-400 text-xs">quick wins</span>
        </div>
      )}
    </div>
  );
}
