import { useMemo } from "react";
import { useStore } from "../../store";
import { ContextGauge } from "../explore/ContextGauge";
import { PromptInput } from "./PromptInput";
import { EvalHistory } from "./EvalHistory";
import { ToolChainViewer } from "./ToolChainViewer";
import { RatingPanel } from "./RatingPanel";

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

export function OptimizeTab() {
  const evalResults = useStore((s) => s.evalResults);
  const optimizeRunning = useStore((s) => s.optimizeRunning);
  const optimizeProgress = useStore((s) => s.optimizeProgress);
  const runOptimize = useStore((s) => s.runOptimize);
  const inventory = useStore((s) => s.inventory);
  const model = useStore((s) => s.model);

  const evalIncluded = useStore((s) => s.evalIncluded);

  const includedRatedCount = evalResults.filter((e, i) => evalIncluded.has(i) && e.rating).length;
  const canOptimize = includedRatedCount > 0 && !optimizeRunning;

  // Compute context window usage — use peak_context_tokens from the most recent eval
  const tokenUsage = useMemo(() => {
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

    // Before any prompts: the inventory estimate uses chars/4 which under-counts
    // by ~1.6x for JSON-heavy tool definitions. Apply correction factor.
    const toolDefTokens = inventory?.total_budget_tokens ?? 0;
    const corrected = Math.round(toolDefTokens * 1.6);
    return { total: corrected };
  }, [evalResults, inventory]);

  const contextWindow = MODEL_CONTEXT[model] ?? 200_000;

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
        <ContextGauge tokens={tokenUsage.total} max={contextWindow} />
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
          <PromptInput />
          <EvalHistory />
        </div>

        {/* Right panel: tool chain viewer + rating */}
        <div className="flex-1 flex flex-col min-h-0">
          <ToolChainViewer />
          <RatingPanel />
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
              {includedRatedCount > 0 && (
                <span className="ml-2 text-xs opacity-75">
                  ({includedRatedCount} included)
                </span>
              )}
            </>
          )}
        </button>
      </div>

    </div>
  );
}
