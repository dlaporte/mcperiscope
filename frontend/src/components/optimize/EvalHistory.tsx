import { useStore } from "../../store";

export function EvalHistory() {
  const evalResults = useStore((s) => s.evalResults);
  const selectedEvalIndex = useStore((s) => s.selectedEvalIndex);
  const evalIncluded = useStore((s) => s.evalIncluded);
  const selectEval = useStore((s) => s.selectEval);
  const toggleEvalIncluded = useStore((s) => s.toggleEvalIncluded);
  const removeEval = useStore((s) => s.removeEval);

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
          {evalResults.length} evaluated, {includedCount} included
        </span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {evalResults.map((evalResult, index) => {
          const isSelected = selectedEvalIndex === index;
          const isIncluded = evalIncluded.has(index);

          return (
            <div
              key={index}
              className="flex items-center transition-colors group"
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
                className="flex-1 text-left px-3 py-3 min-w-0"
              >
                <p className="text-sm truncate" style={{ color: 'var(--sub-text)' }}>
                  {evalResult.prompt}
                </p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--sub-text-dim)' }}>
                  {evalResult.toolChain.length} tool call
                  {evalResult.toolChain.length !== 1 ? "s" : ""}
                </p>
              </button>

              {/* Delete */}
              <button
                onClick={(e) => { e.stopPropagation(); removeEval(index); }}
                className="pr-3 py-3 opacity-0 group-hover:opacity-100 transition-opacity"
                title="Remove evaluation"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="var(--sub-red)" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
