import { useMemo, useState } from "react";
import { useStore, selectContextWindow } from "../../store";
import { ContextGauge } from "../explore/ContextGauge";
import { UsageBar } from "../shared/UsageBar";
import { PromptInput } from "./PromptInput";
import { ResourcePicker } from "./ResourcePicker";
import { EvalHistory } from "./EvalHistory";
import { ToolChainViewer } from "./ToolChainViewer";
import { ContextModal } from "./ContextModal";

export function OptimizeTab() {
  const evalResults = useStore((s) => s.evalResults);
  const inventory = useStore((s) => s.inventory);
  const contextWindow = useStore(selectContextWindow);
  const evalLoading = useStore((s) => s.evalLoading);
  const liveContextTokens = useStore((s) => s.liveContextTokens);
  const loadedResources = useStore((s) => s.loadedResources);

  const [showContext, setShowContext] = useState(false);

  // Backend index of the most recent completed eval (context is fetched from the backend session)
  const latestBackendIndex = useMemo(() => {
    for (let i = evalResults.length - 1; i >= 0; i--) {
      const idx = evalResults[i].backendIndex;
      if (idx !== undefined) return idx;
    }
    return null;
  }, [evalResults]);

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

  return (
    <div className="h-full flex flex-col relative">
      {/* Context usage bar */}
      <UsageBar>
        <ContextGauge tokens={tokenUsage.total} max={contextWindow} onClick={latestBackendIndex !== null ? () => setShowContext(true) : undefined} />
      </UsageBar>

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

      {showContext && latestBackendIndex !== null && (
        <ContextModal evalIndex={latestBackendIndex} totalTokens={tokenUsage.total} onClose={() => setShowContext(false)} />
      )}
    </div>
  );
}
