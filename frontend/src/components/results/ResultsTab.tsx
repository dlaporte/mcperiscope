import { useEffect, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useStore } from "../../store";
import { ComparisonTable } from "./ComparisonTable";
import { AnalystResults } from "./AnalystResults";
import { RecommendationsPanel } from "./RecommendationsPanel";
import { RunSelector } from "./RunSelector";
import { ResponsesModal } from "./ResponsesModal";
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
  const comparison = useStore((s) => s.comparison);
  const recommendations = useStore((s) => s.recommendations);
  const quickWins = useStore((s) => s.quickWins);
  const planMarkdown = useStore((s) => s.planMarkdown);
  const resultsLoading = useStore((s) => s.resultsLoading);
  const fetchComparison = useStore((s) => s.fetchComparison);
  const fetchRecommendations = useStore((s) => s.fetchRecommendations);
  const fetchPlan = useStore((s) => s.fetchPlan);
  const optimizationRuns = useStore((s) => s.optimizationRuns);
  const selectedRunId = useStore((s) => s.selectedRunId);
  const selectRun = useStore((s) => s.selectRun);
  const evalResults = useStore((s) => s.evalResults);

  const [showResponses, setShowResponses] = useState(false);

  useEffect(() => {
    fetchComparison();
    fetchRecommendations();
    fetchPlan();
  }, [fetchComparison, fetchRecommendations, fetchPlan]);

  if (resultsLoading) {
    return (
      <div className="flex items-center justify-center h-full" style={{ color: 'var(--sub-text-dim)' }}>
        <div className="flex items-center gap-3">
          <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Loading results...
        </div>
      </div>
    );
  }

  const hasRecs = recommendations.length > 0 || quickWins.length > 0;
  const hasData = comparison || hasRecs || optimizationRuns.length > 0 || planMarkdown;

  if (!hasData) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center max-w-md">
          <div className="mb-4" style={{ color: 'var(--sub-text-dim)' }}>
            <svg className="w-16 h-16 mx-auto opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </div>
          <p className="text-lg font-medium" style={{ color: 'var(--sub-text-dim)' }}>No optimization data yet</p>
          <p className="text-sm mt-2" style={{ color: 'var(--sub-text-dim)' }}>
            Run evaluations on the Evaluate tab, then click Optimize to analyze tool usage patterns.
          </p>
        </div>
      </div>
    );
  }

  // Derive display data from selected run or fallback to global state
  const selectedRun = optimizationRuns.find((r) => r.id === selectedRunId);
  const comparisonData = selectedRun?.comparison || comparison;
  const analystResults = selectedRun?.analystResults || comparison?.analyst_results || [];
  const proxyAnswers = selectedRun?.proxyAnswers || [];

  const runSelectorNode = optimizationRuns.length > 1 ? (
    <RunSelector
      runs={optimizationRuns}
      selectedId={selectedRunId}
      onSelect={selectRun}
    />
  ) : null;

  return (
    <div className="h-full flex">
      {/* Left panel: Recommendations */}
      <div
        className="w-80 shrink-0 h-full overflow-hidden flex flex-col"
        style={{ borderRight: '1px solid var(--sub-rivet)', backgroundColor: 'var(--sub-panel)' }}
      >
        <RecommendationsPanel />
      </div>

      {/* Right panel: Results */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto p-6 space-y-6">
          {comparisonData && (
            <ComparisonTable data={comparisonData} runSelector={runSelectorNode} />
          )}

          {analystResults.length > 0 && (
            <CollapsibleSection title="Accuracy" defaultOpen={false}>
              <AnalystResults results={analystResults} />
            </CollapsibleSection>
          )}

          {proxyAnswers.length > 0 && (
            <div className="panel-riveted rounded-lg p-4">
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
            </div>
          )}

          {planMarkdown && (
            <CollapsibleSection title="Optimization Plan" defaultOpen={false}>
              <div className="p-4 prose prose-sm prose-invert max-w-none" style={{ color: 'var(--sub-text)' }}>
                <Markdown remarkPlugins={[remarkGfm]}>{planMarkdown}</Markdown>
              </div>
            </CollapsibleSection>
          )}

          <ExportPanel runId={selectedRunId} />
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
    </div>
  );
}
