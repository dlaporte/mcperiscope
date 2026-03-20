import { useState } from "react";
import { useStore } from "../../store";

export function PromptInput() {
  const [prompt, setPrompt] = useState("");
  const connected = useStore((s) => s.connected);
  const evalLoading = useStore((s) => s.evalLoading);
  const evaluate = useStore((s) => s.evaluate);

  const canEvaluate = connected && prompt.trim().length > 0 && !evalLoading;

  const handleSubmit = async () => {
    if (!canEvaluate) return;
    await evaluate(prompt.trim());
    setPrompt("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canEvaluate) {
      handleSubmit();
    }
  };

  return (
    <div className="p-4 border-b border-gray-700">
      <label className="block text-sm font-medium text-gray-300 mb-2">
        Natural Language Prompt
      </label>
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Ask a question that exercises the MCP tools..."
        disabled={!connected || evalLoading}
        rows={3}
        className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none disabled:opacity-50"
      />
      <div className="flex items-center justify-between mt-2">
        <span className="text-xs text-gray-500">
          {evalLoading ? "LLM is working..." : "Cmd+Enter to evaluate"}
        </span>
        <button
          onClick={handleSubmit}
          disabled={!canEvaluate}
          className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-medium rounded-lg transition-colors"
        >
          {evalLoading ? (
            <span className="flex items-center gap-2">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Evaluating...
            </span>
          ) : (
            "Evaluate"
          )}
        </button>
      </div>
    </div>
  );
}
