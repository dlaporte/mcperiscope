import { useMemo, useState } from "react";
import { useStore } from "../../store";
import { MODEL_CONTEXT } from "../../config/models";
import { ContextGauge } from "../explore/ContextGauge";
import { PromptInput } from "./PromptInput";
import { ResourcePicker } from "./ResourcePicker";
import { EvalHistory } from "./EvalHistory";
import { ToolChainViewer } from "./ToolChainViewer";
import { ContextModal } from "./ContextModal";

export function OptimizeTab() {
  const evalResults = useStore((s) => s.evalResults);
  const optimizeRunning = useStore((s) => s.optimizeRunning);
  const optimizeProgress = useStore((s) => s.optimizeProgress);
  const runOptimize = useStore((s) => s.runOptimize);
  const inventory = useStore((s) => s.inventory);
  const model = useStore((s) => s.model);
  const customContextWindow = useStore((s) => s.customContextWindow);
  const evalLoading = useStore((s) => s.evalLoading);
  const liveContextTokens = useStore((s) => s.liveContextTokens);
  const loadedResources = useStore((s) => s.loadedResources);

  const evalIncluded = useStore((s) => s.evalIncluded);

  const [showContext, setShowContext] = useState(false);

  const includedCount = evalResults.filter((_, i) => evalIncluded.has(i)).length;
  const canOptimize = includedCount > 0 && !optimizeRunning;
  const latestEvalIndex = evalResults.length > 0 ? evalResults.length - 1 : null;

  // Token cost of loaded resources
  const loadedResourceTokens = useMemo(
    () => loadedResources.reduce((sum, r) => sum + r.tokens, 0),
    [loadedResources]
  );

  // Compute context window usage — live estimate while loading, API-reported when done
  const tokenUsage = useMemo(() => {
    // While eval is in progress, use the live streaming estimate
    if (evalLoading && liveContextTokens > 0) {
      return { total: liveContextTokens };
    }

    // Find the most recent eval with API usage data
    let peakContext = 0;
    for (let i = evalResults.length - 1; i >= 0; i--) {
      const usage = evalResults[i]?.usage;
      if (usage?.peak_context_tokens) {
        peakContext = usage.peak_context_tokens;
        break;
      }
    }

    if (peakContext > 0) {
      return { total: peakContext };
    }

    const toolDefTokens = inventory?.totalBudgetTokens ?? 0;
    return { total: toolDefTokens + loadedResourceTokens };
  }, [evalResults, inventory, evalLoading, liveContextTokens, loadedResourceTokens]);

  const contextWindow = inventory?.contextWindow ?? MODEL_CONTEXT[model] ?? customContextWindow ?? 200_000;

  return (
    <div className="h-full flex flex-col relative">
      {/* Context usage bar */}
      <div
        className="flex items-center gap-3 px-4 py-2"
        style={{ backgroundColor: 'var(--sub-panel)', borderBottom: '1px solid var(--sub-rivet)' }}
      >
        <span className="font-stencil text-xs whitespace-nowrap" style={{ color: 'var(--sub-text-dim)' }}>
          Session usage
        </span>
        <ContextGauge tokens={tokenUsage.total} max={contextWindow} onClick={latestEvalIndex !== null ? () => setShowContext(true) : undefined} />
      </div>

      <div className="flex-1 flex min-h-0">
        {/* Left panel: prompt input + eval history */}
        <div className="w-1/3 flex flex-col min-h-0" style={{ borderRight: '1px solid var(--sub-rivet)' }}>
          {/* Explanation */}
          <div className="px-4 pt-4 pb-2">
            <p className="text-xs leading-relaxed" style={{ color: 'var(--sub-text-dim)' }}>
              Test how well an LLM uses this MCP's tools by entering real questions below.
              The LLM will chain tool calls to answer each prompt. Rate the responses for correctness,
              then click <strong style={{ color: 'var(--sub-brass)' }}>Optimize</strong> to analyze tool usage
              patterns and generate recommendations for reducing token waste, consolidating tools, and
              improving accuracy.
            </p>
          </div>
          <ResourcePicker />
          <PromptInput />
          <EvalHistory />
        </div>

        {/* Right panel: tool chain viewer */}
        <div className="flex-1 flex flex-col min-h-0">
          <ToolChainViewer />
        </div>
      </div>

      {/* Optimize button + progress */}
      <div className="absolute bottom-6 right-6 flex items-center gap-3">
        {optimizeRunning && optimizeProgress && (
          <div
            className="px-4 py-2 rounded-lg text-xs flex items-center gap-2 max-w-md panel-riveted"
          >
            <div
              className="w-3 h-3 border-2 rounded-full animate-spin flex-shrink-0"
              style={{ borderColor: 'var(--sub-brass)', borderTopColor: 'transparent' }}
            />
            <span style={{ color: 'var(--sub-text)' }}>{optimizeProgress}</span>
          </div>
        )}
        <button
          onClick={runOptimize}
          disabled={!canOptimize}
          className={`px-6 py-3 rounded-xl font-semibold text-sm shadow-lg transition-all ${
            canOptimize
              ? "btn-brass"
              : "cursor-not-allowed"
          }`}
          style={!canOptimize ? { backgroundColor: 'var(--sub-panel-light)', color: 'var(--sub-text-dim)' } : {}}
        >
          {optimizeRunning ? (
            <span className="flex items-center gap-2">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Optimizing...
            </span>
          ) : (
            <>
              Optimize
              {includedCount > 0 && (
                <span className="ml-2 text-xs opacity-75">
                  ({includedCount} included)
                </span>
              )}
            </>
          )}
        </button>
      </div>

      {showContext && latestEvalIndex !== null && (
        <ContextModal evalIndex={latestEvalIndex} totalTokens={tokenUsage.total} onClose={() => setShowContext(false)} />
      )}
    </div>
  );
}
