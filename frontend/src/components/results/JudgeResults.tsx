import { useState } from "react";

interface JudgeResult {
  prompt: string;
  verdict: "equivalent" | "partial" | "different" | "contradictory" | "error";
  explanation: string;
}

interface Props {
  results: JudgeResult[];
}

const verdictStyles: Record<string, { color: string; label: string }> = {
  equivalent: { color: "var(--sub-phosphor)", label: "Equivalent" },
  partial: { color: "var(--sub-brass)", label: "Partial" },
  different: { color: "var(--sub-red)", label: "Different" },
  contradictory: { color: "var(--sub-red)", label: "Contradictory" },
  error: { color: "var(--sub-text-dim)", label: "Error" },
};

export function JudgeResults({ results }: Props) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  if (!results || results.length === 0) return null;

  const equivalent = results.filter((r) => r.verdict === "equivalent").length;
  const total = results.length;

  return (
    <div className="panel-riveted rounded-lg overflow-hidden">
      <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--sub-rivet)" }}>
        <h3 className="text-lg font-semibold font-stencil" style={{ color: "var(--sub-text)" }}>
          Answer Equivalence
        </h3>
        <p className="text-sm mt-1" style={{ color: "var(--sub-text-dim)" }}>
          LLM judge compared baseline vs optimized answers for each prompt
        </p>
      </div>

      {/* Summary */}
      <div className="px-4 py-3 flex items-center gap-4" style={{ borderBottom: "1px solid var(--sub-rivet)" }}>
        <span
          className="text-2xl font-mono font-bold"
          style={{ color: equivalent === total ? "var(--sub-phosphor)" : "var(--sub-brass)" }}
        >
          {equivalent}/{total}
        </span>
        <span style={{ color: "var(--sub-text-dim)" }}>
          answers are semantically equivalent
        </span>
      </div>

      {/* Per-prompt results */}
      <div>
        {results.map((result, i) => {
          const style = verdictStyles[result.verdict] || verdictStyles.error;
          const isExpanded = expandedIndex === i;
          return (
            <div
              key={i}
              style={{ borderBottom: "1px solid rgba(74,78,80,0.5)" }}
            >
              <button
                className="w-full text-left px-4 py-3 flex items-center gap-3 transition-colors"
                onClick={() => setExpandedIndex(isExpanded ? null : i)}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--sub-panel-light)")}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
              >
                <span
                  className="text-xs font-semibold uppercase px-2 py-0.5 rounded shrink-0"
                  style={{ color: style.color, backgroundColor: `${style.color}20` }}
                >
                  {style.label}
                </span>
                <span className="text-sm truncate" style={{ color: "var(--sub-text)" }}>
                  {result.prompt}
                </span>
                <span className="text-xs shrink-0 ml-auto" style={{ color: "var(--sub-text-dim)" }}>
                  {isExpanded ? "▾" : "▸"}
                </span>
              </button>
              {isExpanded && result.explanation && (
                <div className="px-4 pb-3 pl-12">
                  <p className="text-xs" style={{ color: "var(--sub-text-dim)" }}>
                    {result.explanation}
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
