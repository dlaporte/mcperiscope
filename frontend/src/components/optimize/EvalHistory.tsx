import { useStore } from "../../store";

const RATING_COLORS: Record<string, string> = {
  correct: "bg-green-500",
  partial: "bg-yellow-500",
  wrong: "bg-red-500",
  skipped: "bg-gray-500",
};

export function EvalHistory() {
  const evalResults = useStore((s) => s.evalResults);
  const selectedEvalIndex = useStore((s) => s.selectedEvalIndex);
  const selectEval = useStore((s) => s.selectEval);

  const ratedCount = evalResults.filter((e) => e.rating).length;

  if (evalResults.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <p className="text-gray-500 text-sm text-center">
          No evaluations yet. Enter a prompt above to get started.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-4 py-2 border-b border-gray-700">
        <span className="text-xs text-gray-400">
          {evalResults.length} prompt{evalResults.length !== 1 ? "s" : ""} evaluated,{" "}
          {ratedCount} rated
        </span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {evalResults.map((evalResult, index) => {
          const isSelected = selectedEvalIndex === index;
          const rating = evalResult.rating?.correctness;
          const dotColor = rating ? RATING_COLORS[rating] : "bg-gray-700";

          return (
            <button
              key={index}
              onClick={() => selectEval(index)}
              className={`w-full text-left px-4 py-3 border-b border-gray-800 hover:bg-gray-800 transition-colors ${
                isSelected ? "bg-gray-800 border-l-2 border-l-blue-500" : ""
              }`}
            >
              <div className="flex items-start gap-3">
                <span
                  className={`mt-1 w-2.5 h-2.5 rounded-full flex-shrink-0 ${dotColor}`}
                  title={rating || "unrated"}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-gray-200 truncate">
                    {evalResult.prompt}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
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
