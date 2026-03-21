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
  const evalIncluded = useStore((s) => s.evalIncluded);
  const selectEval = useStore((s) => s.selectEval);
  const toggleEvalIncluded = useStore((s) => s.toggleEvalIncluded);

  const ratedCount = evalResults.filter((e) => e.rating).length;
  const includedCount = evalIncluded.size;

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
          {evalResults.length} evaluated, {ratedCount} rated, {includedCount} included
        </span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {evalResults.map((evalResult, index) => {
          const isSelected = selectedEvalIndex === index;
          const isIncluded = evalIncluded.has(index);
          const rating = evalResult.rating?.correctness;
          const dotStyle = rating ? RATING_STYLES[rating] : { backgroundColor: 'var(--sub-panel-light)' };

          return (
            <div
              key={index}
              className="flex items-center transition-colors"
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
              {/* Checkbox */}
              <label
                className="pl-3 py-3 cursor-pointer flex items-center"
                onClick={(e) => e.stopPropagation()}
              >
                <input
                  type="checkbox"
                  checked={isIncluded}
                  onChange={() => toggleEvalIncluded(index)}
                  className="w-3.5 h-3.5 rounded cursor-pointer accent-amber-600"
                />
              </label>

              {/* Clickable prompt area */}
              <button
                onClick={() => selectEval(index)}
                className="flex-1 text-left px-3 py-3"
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
            </div>
          );
        })}
      </div>
    </div>
  );
}
