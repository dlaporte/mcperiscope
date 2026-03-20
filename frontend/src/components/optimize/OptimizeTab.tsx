import { useStore } from "../../store";
import { PromptInput } from "./PromptInput";
import { EvalHistory } from "./EvalHistory";
import { ToolChainViewer } from "./ToolChainViewer";
import { RatingPanel } from "./RatingPanel";

export function OptimizeTab() {
  const evalResults = useStore((s) => s.evalResults);
  const optimizeRunning = useStore((s) => s.optimizeRunning);
  const runOptimize = useStore((s) => s.runOptimize);

  const ratedCount = evalResults.filter((e) => e.rating).length;
  const canOptimize = ratedCount > 0 && !optimizeRunning;

  return (
    <div className="h-full flex relative">
      {/* Left panel: prompt input + eval history */}
      <div className="w-1/3 border-r border-gray-700 flex flex-col min-h-0">
        <PromptInput />
        <EvalHistory />
      </div>

      {/* Right panel: tool chain viewer + rating */}
      <div className="flex-1 flex flex-col min-h-0">
        <ToolChainViewer />
        <RatingPanel />
      </div>

      {/* Optimize button */}
      <button
        onClick={runOptimize}
        disabled={!canOptimize}
        className={`absolute bottom-6 right-6 px-6 py-3 rounded-xl font-semibold text-sm shadow-lg transition-all ${
          canOptimize
            ? "bg-purple-600 hover:bg-purple-500 text-white shadow-purple-900/50 hover:shadow-purple-800/50"
            : "bg-gray-700 text-gray-500 cursor-not-allowed"
        }`}
      >
        {optimizeRunning ? (
          <span className="flex items-center gap-2">
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Optimizing...
          </span>
        ) : (
          <>
            Optimize
            {ratedCount > 0 && (
              <span className="ml-2 text-xs opacity-75">
                ({ratedCount} rated)
              </span>
            )}
          </>
        )}
      </button>
    </div>
  );
}
