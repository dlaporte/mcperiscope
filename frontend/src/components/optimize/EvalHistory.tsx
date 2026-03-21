import { useStore } from "../../store";

const RATING_STYLES: Record<string, React.CSSProperties> = {
  correct: { backgroundColor: 'var(--sub-phosphor)' },
  partial: { backgroundColor: 'var(--sub-brass)' },
  wrong: { backgroundColor: 'var(--sub-red)' },
  skipped: { backgroundColor: 'var(--sub-text-dim)' },
};

export function EvalHistory() {
  const evalResults = useStore((s) => s.evalResults);
  const selectedEvalIndex = useStore((s) => s.selectedEvalIndex);
  const selectEval = useStore((s) => s.selectEval);

  const ratedCount = evalResults.filter((e) => e.rating).length;

  if (evalResults.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <p className="text-sm text-center" style={{ color: 'var(--sub-text-dim)' }}>
          No evaluations yet. Enter a prompt above to get started.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-4 py-2" style={{ borderBottom: '1px solid var(--sub-rivet)' }}>
        <span className="text-xs" style={{ color: 'var(--sub-text-dim)' }}>
          {evalResults.length} prompt{evalResults.length !== 1 ? "s" : ""} evaluated,{" "}
          {ratedCount} rated
        </span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {evalResults.map((evalResult, index) => {
          const isSelected = selectedEvalIndex === index;
          const rating = evalResult.rating?.correctness;
          const dotStyle = rating ? RATING_STYLES[rating] : { backgroundColor: 'var(--sub-panel-light)' };

          return (
            <button
              key={index}
              onClick={() => selectEval(index)}
              className="w-full text-left px-4 py-3 transition-colors"
              style={{
                borderBottom: '1px solid var(--sub-hull)',
                backgroundColor: isSelected ? 'var(--sub-panel-light)' : 'transparent',
                borderLeft: isSelected ? '2px solid var(--sub-brass)' : '2px solid transparent',
              }}
              onMouseEnter={(e) => {
                if (!isSelected) e.currentTarget.style.backgroundColor = 'var(--sub-panel)';
              }}
              onMouseLeave={(e) => {
                if (!isSelected) e.currentTarget.style.backgroundColor = 'transparent';
              }}
            >
              <div className="flex items-start gap-3">
                <span
                  className="mt-1 w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={dotStyle}
                  title={rating || "unrated"}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm truncate" style={{ color: 'var(--sub-text)' }}>
                    {evalResult.prompt}
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--sub-text-dim)' }}>
                    {evalResult.toolChain.length} tool call
                    {evalResult.toolChain.length !== 1 ? "s" : ""}
                  </p>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
