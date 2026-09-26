import { useEffect, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "../../api/client";
import { useStore, includedBackendIndices, selectContextWindow, selectLoadedResourceTokens } from "../../store";
import { ComparisonTable } from "./ComparisonTable";
import { AnalystResults } from "./AnalystResults";
import { RecommendationsPanel } from "./RecommendationsPanel";
import { InventoryPanel } from "./InventoryPanel";
import { RunSelector } from "./RunSelector";
import { ResponsesModal } from "./ResponsesModal";
import { ResourcesModal } from "./ResourcesModal";
import { OptimizeContextGauge } from "./OptimizeContextGauge";
import { ExportPanel } from "./ExportPanel";

function InventorySection() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="w-full text-left px-3 py-2 flex items-center justify-between hover:bg-[var(--sub-panel-light)]"
        style={{ borderBottom: '1px solid var(--sub-rivet)' }}
      >
        <h3 className="text-sm font-semibold font-stencil" style={{ color: 'var(--sub-text)' }}>
          Inventory
        </h3>
        <span className="text-xs" style={{ color: 'var(--sub-text-dim)' }}>{open ? "\u25BE" : "\u25B8"}</span>
      </button>
      {open && (
        <div style={{ maxHeight: '40vh', overflow: 'auto' }}>
          <InventoryPanel />
        </div>
      )}
    </div>
  );
}

function OptimizeButton() {
  const enabledRecIds = useStore((s) => s.enabledRecIds);
  const recommendations = useStore((s) => s.recommendations);
  const quickWins = useStore((s) => s.quickWins);
  const optimizeRunning = useStore((s) => s.optimizeRunning);
  const optimizeProgress = useStore((s) => s.optimizeProgress);
  const error = useStore((s) => s.optimizeError);
  const runOptimizeWithSelection = useStore((s) => s.runOptimizeWithSelection);
  const includedEvalCount = useStore((s) => includedBackendIndices(s).length);

  const hasAny = recommendations.length > 0 || quickWins.length > 0;
  const enabledCount = enabledRecIds.size;

  return (
    <div className="px-3 py-3 shrink-0" style={{ borderTop: '1px solid var(--sub-rivet)' }}>
      <button
        onClick={runOptimizeWithSelection}
        disabled={!hasAny || enabledCount === 0 || includedEvalCount === 0 || optimizeRunning}
        title={includedEvalCount === 0 ? "Include at least one evaluation to optimize" : undefined}
        className="w-full py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        style={{
          backgroundColor: optimizeRunning ? 'var(--sub-panel-light)' : 'var(--sub-brass)',
          color: optimizeRunning ? 'var(--sub-text)' : 'var(--sub-hull)',
        }}
      >
        {optimizeRunning ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            {optimizeProgress || "Optimizing..."}
          </span>
        ) : (
          `Optimize (${enabledCount} selected)`
        )}
      </button>
      {error && (
        <p className="text-xs mt-2" style={{ color: 'var(--sub-red)' }}>{error}</p>
      )}
    </div>
  );
}

function CollapsibleSection({ title, defaultOpen = true, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="panel-riveted rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full text-left px-4 py-3 flex items-center justify-between hover:bg-[var(--sub-panel-light)]"
        style={{ borderBottom: open ? '1px solid var(--sub-rivet)' : 'none' }}
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
  const planMarkdown = useStore((s) => s.planMarkdown);
  const refreshRecommendations = useStore((s) => s.refreshRecommendations);
  const analyzing = useStore((s) => s.analyzing);
  const optimizationRuns = useStore((s) => s.optimizationRuns);
  const selectedRunId = useStore((s) => s.selectedRunId);
  const selectRun = useStore((s) => s.selectRun);
  const evalResults = useStore((s) => s.evalResults);
  // Joined so the selector result is stable between renders
  const includedKey = useStore((s) => includedBackendIndices(s).join(","));
  // Baseline total context includes the loaded resources
  const loadedResourceTokens = useStore(selectLoadedResourceTokens);
  const contextWindow = useStore(selectContextWindow);

  const [showResponses, setShowResponses] = useState(false);
  const [showResources, setShowResources] = useState(false);
  const [baseline, setBaseline] = useState<Record<string, number>>({});

  // On mount, pick up the latest recommendations, re-analyzing if evals changed since
  useEffect(() => {
    refreshRecommendations();
  }, [refreshRecommendations]);

  // Baseline-only comparison over the included evals, computed by the backend
  // the same way as a run's baseline
  useEffect(() => {
    let cancelled = false;
    const included = includedKey ? includedKey.split(",").map(Number) : [];
    api.getBaseline(included)
      .then((data) => { if (!cancelled) setBaseline(data); })
      .catch(() => { /* keep the previous figures */ });
    return () => { cancelled = true; };
  }, [includedKey, loadedResourceTokens]);
  const baselineComparison = { baseline, proxy: {}, delta: {} };

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

  // Derive display data from selected run or baseline-only
  const selectedRun = optimizationRuns.find((r) => r.id === selectedRunId);
  const comparisonData = selectedRun?.comparison || baselineComparison;
  const analystResults = selectedRun?.analystResults || [];
  const proxyAnswers = selectedRun?.proxyAnswers || [];
  const condensedResources = selectedRun?.condensedResources;
  const skippedRecs = selectedRun?.skippedRecs ?? [];

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
        max={contextWindow}
      />

      <div className="flex-1 flex min-h-0">
      {/* Left panel: Inventory + Recommendations + Optimize button */}
      <div
        className="w-80 shrink-0 h-full overflow-hidden flex flex-col"
        style={{ borderRight: '1px solid var(--sub-rivet)', backgroundColor: 'var(--sub-panel)' }}
      >
        <div className="flex-1 overflow-y-auto">
          <InventorySection />
          {analyzing ? (
            <div className="flex items-center justify-center py-8">
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
        <OptimizeButton />
      </div>

      {/* Right panel: Results */}
      <div className="flex-1 flex flex-col overflow-hidden">

        <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto p-6 space-y-6">
          <ComparisonTable data={comparisonData} runSelector={runSelectorNode} />

          {skippedRecs.length > 0 && (
            <div
              className="rounded-lg px-4 py-3 text-sm"
              style={{ backgroundColor: 'rgba(196,154,42,0.1)', border: '1px solid var(--sub-brass-dim)', color: 'var(--sub-brass)' }}
            >
              {skippedRecs.length} optimization{skippedRecs.length === 1 ? " was" : "s were"} skipped:{" "}
              {skippedRecs.map((r) => `${r.type} (${r.reason})`).join("; ")}
            </div>
          )}

          {analystResults.length > 0 && (
            <CollapsibleSection title="Accuracy" defaultOpen={false}>
              <AnalystResults results={analystResults} />
            </CollapsibleSection>
          )}

          {proxyAnswers.length > 0 && (
            <div className="panel-riveted rounded-lg p-4 space-y-2">
              <button
                onClick={() => setShowResponses(true)}
                className="flex items-center gap-2 text-sm font-medium transition-colors text-[var(--sub-brass)] hover:text-[var(--sub-brass-glow)]"
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
                  className="flex items-center gap-2 text-sm font-medium transition-colors text-[var(--sub-brass)] hover:text-[var(--sub-brass-glow)]"
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

          {selectedRun && <ExportPanel runId={selectedRun.id} />}
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
