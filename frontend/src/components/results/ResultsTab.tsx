import { useEffect } from "react";
import { useStore } from "../../store";
import { ComparisonTable } from "./ComparisonTable";
import { JudgeResults } from "./JudgeResults";
import { RecommendationCards } from "./RecommendationCards";
import { ExportPanel } from "./ExportPanel";

export function ResultsTab() {
  const comparison = useStore((s) => s.comparison);
  const recommendations = useStore((s) => s.recommendations);
  const resultsLoading = useStore((s) => s.resultsLoading);
  const fetchComparison = useStore((s) => s.fetchComparison);
  const fetchRecommendations = useStore((s) => s.fetchRecommendations);

  useEffect(() => {
    fetchComparison();
    fetchRecommendations();
  }, [fetchComparison, fetchRecommendations]);

  if (resultsLoading) {
    return (
      <div className="flex items-center justify-center h-full" style={{ color: 'var(--sub-text-dim)' }}>
        <div className="flex items-center gap-3">
          <svg
            className="animate-spin h-5 w-5"
            viewBox="0 0 24 24"
            fill="none"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
          Loading results...
        </div>
      </div>
    );
  }

  const hasData = comparison || recommendations.length > 0;

  if (!hasData) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="text-4xl mb-4" style={{ color: 'var(--sub-text-dim)' }}>
            <svg
              className="w-16 h-16 mx-auto opacity-30"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
              />
            </svg>
          </div>
          <p className="text-lg font-medium" style={{ color: 'var(--sub-text-dim)' }}>No results yet</p>
          <p className="text-sm mt-1" style={{ color: 'var(--sub-text-dim)' }}>
            Run optimization first to see before/after comparison and
            recommendations.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto p-6 space-y-6">
        {comparison && <ComparisonTable data={comparison} />}

        {comparison?.judge_results?.length > 0 && (
          <JudgeResults results={comparison.judge_results} />
        )}

        {recommendations.length > 0 && (
          <RecommendationCards recommendations={recommendations} />
        )}

        <ExportPanel />
      </div>
    </div>
  );
}
