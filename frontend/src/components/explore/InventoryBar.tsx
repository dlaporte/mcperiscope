import { useState, useEffect, useRef, useCallback } from "react";
import { useStore } from "../../store";
import { ContextGauge } from "./ContextGauge";

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
    <div className="panel-riveted rounded-lg p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${badgeClass}`}>
              {win.type}
            </span>
            {win.estimated_savings != null && win.estimated_savings > 0 && (
              <span className="phosphor-text text-[10px]">
                ~{win.estimated_savings.toLocaleString()} tokens saved
              </span>
            )}
          </div>
          <p className="text-xs leading-relaxed" style={{ color: 'var(--sub-text)' }}>{win.description}</p>
        </div>
        {win.tools.length > 0 && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-[10px] shrink-0 mt-0.5"
            style={{ color: 'var(--sub-text-dim)' }}
          >
            {expanded ? "hide" : `${win.tools.length} tools`}
          </button>
        )}
      </div>
      {expanded && win.tools.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {win.tools.map((t) => (
            <span
              key={t}
              className="text-[10px] font-mono px-1.5 py-0.5 rounded"
              style={{ backgroundColor: 'var(--sub-hull)', color: 'var(--sub-text-dim)' }}
            >
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
    <div
      className="relative flex items-center gap-4 px-4 py-2 text-sm"
      style={{ backgroundColor: 'var(--sub-panel)', borderBottom: '1px solid var(--sub-rivet)' }}
    >
      {/* Context budget */}
      <span className="font-stencil text-xs whitespace-nowrap" style={{ color: 'var(--sub-text-dim)' }}>Tool context usage</span>
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

      {/* Quick wins */}
      {quickWinsList.length > 0 && (
        <div className="relative" ref={panelRef}>
          <button
            onClick={() => setShowQuickWins(!showQuickWins)}
            className="flex items-center gap-1.5 hover:opacity-80 transition-opacity"
          >
            <span className="phosphor-text text-xs font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: 'rgba(51,255,51,0.15)' }}>
              {quickWinsList.length}
            </span>
            <span className="text-xs" style={{ color: 'var(--sub-text-dim)' }}>quick wins</span>
          </button>

          {/* Quick wins dropdown */}
          {showQuickWins && (
            <div
              className="absolute right-0 top-full mt-2 w-[480px] max-h-[400px] overflow-y-auto rounded-xl shadow-2xl z-50 p-4"
              style={{ backgroundColor: 'var(--sub-hull)', border: '1px solid var(--sub-rivet)' }}
            >
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold font-stencil" style={{ color: 'var(--sub-text)' }}>Quick Wins</h3>
                <button
                  onClick={() => setShowQuickWins(false)}
                  className="text-xs"
                  style={{ color: 'var(--sub-text-dim)' }}
                >
                  Close
                </button>
              </div>
              <p className="text-xs mb-3" style={{ color: 'var(--sub-text-dim)' }}>
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
