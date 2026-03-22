import { useEffect, useState, useMemo } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useStore } from "../../store";
import { MODEL_CONTEXT } from "../../config/models";
import { ComparisonTable } from "./ComparisonTable";
import { AnalystResults } from "./AnalystResults";
import { RecommendationsPanel } from "./RecommendationsPanel";
import { RunSelector } from "./RunSelector";
import { ResponsesModal } from "./ResponsesModal";
import { ResourcesModal } from "./ResourcesModal";
import { OptimizeContextGauge } from "./OptimizeContextGauge";
import { ExportPanel } from "./ExportPanel";

function CollapsibleSection({ title, defaultOpen = true, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="panel-riveted rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full text-left px-4 py-3 flex items-center justify-between"
        style={{ borderBottom: open ? '1px solid var(--sub-rivet)' : 'none' }}
        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--sub-panel-light)')}
        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
      >
        <h3 className="text-lg font-semibold font-stencil" style={{ color: 'var(--sub-text)' }}>
          {title}
        </h3>
        <span style={{ color: 'var(--sub-text-dim)' }}>{open ? "\u25BE" : "\u25B8"}</span>
      </button>
      {open && children}
    </div>
  );
}

export function ResultsTab() {
  const recommendations = useStore((s) => s.recommendations);
  const quickWins = useStore((s) => s.quickWins);
  const planMarkdown = useStore((s) => s.planMarkdown);
  const fetchRecommendations = useStore((s) => s.fetchRecommendations);
  const fetchPlan = useStore((s) => s.fetchPlan);
  const analyzeTools = useStore((s) => s.analyzeTools);
  const optimizationRuns = useStore((s) => s.optimizationRuns);
  const selectedRunId = useStore((s) => s.selectedRunId);
  const selectRun = useStore((s) => s.selectRun);
  const evalResults = useStore((s) => s.evalResults);
  const loadedResources = useStore((s) => s.loadedResources);
  const inventory = useStore((s) => s.inventory);
  const model = useStore((s) => s.model);
  const customContextWindow = useStore((s) => s.customContextWindow);

  const [showResponses, setShowResponses] = useState(false);
  const [showResources, setShowResources] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);

  // On mount, run analysis if we have eval results but no recommendations
  useEffect(() => {
    if (evalResults.length > 0 && recommendations.length === 0 && quickWins.length === 0) {
      setAnalyzing(true);
      analyzeTools().finally(() => setAnalyzing(false));
    }
    fetchRecommendations();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const hasEvals = evalResults.length > 0;

  if (!hasEvals) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center max-w-md">
          <div className="mb-4" style={{ color: 'var(--sub-text-dim)' }}>
            <svg className="w-16 h-16 mx-auto opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </div>
          <p className="text-lg font-medium" style={{ color: 'var(--sub-text-dim)' }}>No evaluation data yet</p>
          <p className="text-sm mt-2" style={{ color: 'var(--sub-text-dim)' }}>
            Run evaluation prompts on the Evaluate tab to establish baseline metrics,
            then return here to optimize.
          </p>
        </div>
      </div>
    );
  }

  // Build baseline-only comparison from eval results (always available)
  const baselineComparison = useMemo(() => {
    const toolTokens = inventory?.total_budget_tokens ?? inventory?.totalBudgetTokens ?? 0;
    const numPrompts = Math.max(evalResults.length, 1);
    let totalTraceTokens = 0;
    let totalCalls = 0;
    let totalLatency = 0;
    let peakContext = 0;
    for (const ev of evalResults) {
      // Use API-reported peak_context_tokens (includes tools + resources + conversation)
      const peak = ev.usage?.peak_context_tokens;
      if (peak && peak > peakContext) peakContext = peak;
      for (const step of (ev.toolChain || [])) {
        totalCalls++;
        totalTraceTokens += Math.max(1, (step.output?.length || 0) / 4);
        totalLatency += step.duration || 0;
      }
    }
    const avgTokens = Math.round(totalTraceTokens / numPrompts);
    const avgCalls = Math.round(totalCalls / numPrompts * 10) / 10;
    const avgLatency = Math.round(totalLatency / numPrompts * 1000);
    const toolCount = inventory?.tool_count ?? 0;
    // Use real API-reported context, fall back to estimate including loaded resources
    const loadedResourceTokens = loadedResources.reduce((sum, r) => sum + r.tokens, 0);
    const totalContext = peakContext > 0 ? peakContext : toolTokens + avgTokens + loadedResourceTokens;

    return {
      baseline: {
        tool_count: toolCount,
        menu_tokens: toolTokens,
        avg_tokens_per_prompt: avgTokens,
        avg_calls_per_prompt: avgCalls,
        total_context: totalContext,
        accuracy: 1.0,
        avg_latency: avgLatency,
      },
      proxy: {},
      delta: {},
    };
  }, [evalResults, inventory, loadedResources]);

  // Derive display data from selected run or baseline-only
  const selectedRun = optimizationRuns.find((r) => r.id === selectedRunId);
  const comparisonData = selectedRun?.comparison || baselineComparison;
  const analystResults = selectedRun?.analystResults || [];
  const proxyAnswers = selectedRun?.proxyAnswers || [];
  const condensedResources = selectedRun?.condensedResources;

  const runSelectorNode = optimizationRuns.length > 0 ? (
    <RunSelector
      runs={optimizationRuns}
      selectedId={selectedRunId}
      onSelect={selectRun}
    />
  ) : undefined;

  return (
    <div className="h-full flex flex-col">
      {/* Context gauge — full width across top */}
      <OptimizeContextGauge
        baseline={comparisonData?.baseline?.total_context || 0}
        optimized={selectedRun ? (comparisonData?.proxy?.total_context ?? null) : null}
        max={inventory?.contextWindow ?? MODEL_CONTEXT[model] ?? customContextWindow ?? 200_000}
      />

      <div className="flex-1 flex min-h-0">
      {/* Left panel: Recommendations */}
      <div
        className="w-80 shrink-0 h-full overflow-hidden flex flex-col"
        style={{ borderRight: '1px solid var(--sub-rivet)', backgroundColor: 'var(--sub-panel)' }}
      >
        {analyzing ? (
          <div className="flex items-center justify-center h-full">
            <div className="flex items-center gap-3" style={{ color: 'var(--sub-text-dim)' }}>
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <span className="text-sm">Analyzing tool usage...</span>
            </div>
          </div>
        ) : (
          <RecommendationsPanel />
        )}
      </div>

      {/* Right panel: Results */}
      <div className="flex-1 flex flex-col overflow-hidden">

        <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto p-6 space-y-6">
          <ComparisonTable data={comparisonData} runSelector={runSelectorNode} />

          {analystResults.length > 0 && (
            <CollapsibleSection title="Accuracy" defaultOpen={false}>
              <AnalystResults results={analystResults} />
            </CollapsibleSection>
          )}

          {proxyAnswers.length > 0 && (
            <div className="panel-riveted rounded-lg p-4 space-y-2">
              <button
                onClick={() => setShowResponses(true)}
                className="flex items-center gap-2 text-sm font-medium transition-colors"
                style={{ color: 'var(--sub-brass)' }}
                onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--sub-brass-glow)')}
                onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--sub-brass)')}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
                View Baseline vs Optimized Responses
              </button>
              {condensedResources && Object.keys(condensedResources).length > 0 && (
                <button
                  onClick={() => setShowResources(true)}
                  className="flex items-center gap-2 text-sm font-medium transition-colors"
                  style={{ color: 'var(--sub-brass)' }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--sub-brass-glow)')}
                  onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--sub-brass)')}
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  View Baseline vs Optimized Resources
                </button>
              )}
            </div>
          )}

          {planMarkdown && selectedRun && (
            <CollapsibleSection title="Optimization Plan" defaultOpen={false}>
              <div className="p-4 prose prose-sm prose-invert max-w-none" style={{ color: 'var(--sub-text)' }}>
                <Markdown remarkPlugins={[remarkGfm]}>{planMarkdown}</Markdown>
              </div>
            </CollapsibleSection>
          )}

          {selectedRun && <ExportPanel runId={selectedRunId} />}
        </div>
        </div>
      </div>
      </div>

      {/* Responses modal */}
      {showResponses && (
        <ResponsesModal
          proxyAnswers={proxyAnswers}
          evalResults={evalResults}
          onClose={() => setShowResponses(false)}
        />
      )}

      {/* Resources modal */}
      {showResources && condensedResources && (
        <ResourcesModal
          resources={condensedResources}
          onClose={() => setShowResources(false)}
        />
      )}
    </div>
  );
}
