import { useState, useEffect, useRef, useCallback } from "react";
import { useStore } from "../../store";
import { ContextBudget } from "./ContextBudget";

interface QuickWin {
  type: string;
  description: string;
  tools: string[];
  estimated_savings?: number;
}

interface InventoryData {
  tool_count: number;
  total_budget_tokens: number;
  tool_tokens?: number;
  resource_tokens?: number;
  prompt_tokens?: number;
  context_window: number;
  context_pct: number;
  model: string;
  quick_wins?: QuickWin[];
}

function QuickWinCard({ win }: { win: QuickWin }) {
  const [expanded, setExpanded] = useState(false);
  const typeColors: Record<string, string> = {
    high_tool_count: "bg-red-500/20 text-red-300",
    high_context_usage: "bg-red-500/20 text-red-300",
    moderate_context_usage: "bg-yellow-500/20 text-yellow-300",
    consolidation: "bg-purple-500/20 text-purple-300",
    duplicate: "bg-yellow-500/20 text-yellow-300",
    oversized_schema: "bg-orange-500/20 text-orange-300",
    missing_description: "bg-red-500/20 text-red-300",
    terse_description: "bg-yellow-500/20 text-yellow-300",
    no_return_info: "bg-blue-500/20 text-blue-300",
    duplicate_description: "bg-orange-500/20 text-orange-300",
  };
  const badgeClass = typeColors[win.type] || "bg-gray-500/20 text-gray-300";

  return (
    <div className="border border-gray-700 rounded-lg p-3 bg-gray-800/50">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${badgeClass}`}>
              {win.type}
            </span>
            {win.estimated_savings != null && win.estimated_savings > 0 && (
              <span className="text-[10px] text-green-400">
                ~{win.estimated_savings.toLocaleString()} tokens saved
              </span>
            )}
          </div>
          <p className="text-xs text-gray-300 leading-relaxed">{win.description}</p>
        </div>
        {win.tools.length > 0 && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-[10px] text-gray-500 hover:text-gray-300 shrink-0 mt-0.5"
          >
            {expanded ? "hide" : `${win.tools.length} tools`}
          </button>
        )}
      </div>
      {expanded && win.tools.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {win.tools.map((t) => (
            <span key={t} className="text-[10px] font-mono bg-gray-900 text-gray-400 px-1.5 py-0.5 rounded">
              {t}
            </span>
          ))}
        </div>
      )}
    </div>
  );
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
  const { tools, model } = useStore();
  const [inventory, setInventory] = useState<InventoryData | null>(null);
  const [loading, setLoading] = useState(false);
  const [showQuickWins, setShowQuickWins] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

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

  const handleClickOutside = useCallback((e: MouseEvent) => {
    if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
      setShowQuickWins(false);
    }
  }, []);

  useEffect(() => {
    if (showQuickWins) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showQuickWins, handleClickOutside]);

  const totalTokens = inventory?.total_budget_tokens ?? 0;
  const contextWindow = MODEL_CONTEXT[model] ?? 200_000;
  const quickWinsList = Array.isArray(inventory?.quick_wins) ? inventory.quick_wins : [];

  return (
    <div className="relative flex items-center gap-4 px-4 py-2 bg-gray-800/50 border-b border-gray-700 text-sm">
      {/* Context budget */}
      <span className="text-xs text-gray-500 whitespace-nowrap">Tool context usage</span>
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

      {/* Quick wins */}
      {quickWinsList.length > 0 && (
        <div className="relative" ref={panelRef}>
          <button
            onClick={() => setShowQuickWins(!showQuickWins)}
            className="flex items-center gap-1.5 hover:opacity-80 transition-opacity"
          >
            <span className="bg-green-500/20 text-green-400 text-xs font-bold px-2 py-0.5 rounded-full">
              {quickWinsList.length}
            </span>
            <span className="text-gray-400 text-xs">quick wins</span>
          </button>

          {/* Quick wins dropdown */}
          {showQuickWins && (
            <div className="absolute right-0 top-full mt-2 w-[480px] max-h-[400px] overflow-y-auto bg-gray-900 border border-gray-700 rounded-xl shadow-2xl z-50 p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-white">Quick Wins</h3>
                <button
                  onClick={() => setShowQuickWins(false)}
                  className="text-gray-500 hover:text-gray-300 text-xs"
                >
                  Close
                </button>
              </div>
              <p className="text-xs text-gray-500 mb-3">
                Optimization opportunities detected from tool inventory analysis.
                These can be addressed on the Optimize tab.
              </p>
              <div className="space-y-2">
                {quickWinsList.map((win, i) => (
                  <QuickWinCard key={i} win={win} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
