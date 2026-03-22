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
  const inventory = useStore((s) => s.inventory);
  const model = useStore((s) => s.model);
  const customContextWindow = useStore((s) => s.customContextWindow);
  const evalLoading = useStore((s) => s.evalLoading);
  const liveContextTokens = useStore((s) => s.liveContextTokens);
  const loadedResources = useStore((s) => s.loadedResources);

  const [showContext, setShowContext] = useState(false);

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
              The LLM will chain tool calls to answer each prompt. Once you have baseline results,
              switch to the <strong style={{ color: 'var(--sub-brass)' }}>Optimize</strong> tab to
              analyze usage patterns and generate optimized proxy configurations.
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

      {showContext && latestEvalIndex !== null && (
        <ContextModal evalIndex={latestEvalIndex} totalTokens={tokenUsage.total} onClose={() => setShowContext(false)} />
      )}
    </div>
  );
}
