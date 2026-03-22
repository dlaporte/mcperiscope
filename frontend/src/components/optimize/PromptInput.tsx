import { useState } from "react";
import { useStore } from "../../store";

export function PromptInput() {
  const [prompt, setPrompt] = useState("");
  const [batch, setBatch] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(null);
  const [batchConfirm, setBatchConfirm] = useState(false);
  const connected = useStore((s) => s.connected);
  const evalLoading = useStore((s) => s.evalLoading);
  const evaluate = useStore((s) => s.evaluate);

  const canEvaluate = connected && prompt.trim().length > 0 && !evalLoading && !batchProgress && !batchConfirm;

  const runBatch = async () => {
    const prompts = prompt.split("\n").map((l) => l.trim()).filter(Boolean);
    if (prompts.length === 0) return;
    setBatch(true);
    setBatchProgress({ current: 0, total: prompts.length });
    try {
      for (let i = 0; i < prompts.length; i++) {
        setBatchProgress({ current: i + 1, total: prompts.length });
        await evaluate(prompts[i]);
      }
    } finally {
      setBatchProgress(null);
    }
    setPrompt("");
  };

  const handleSubmit = async () => {
    if (!canEvaluate) return;

    if (batch) {
      await runBatch();
      return;
    }

    // In single mode, check for newlines that suggest batch input
    const lines = prompt.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length > 1) {
      setBatchConfirm(true);
      return;
    }

    await evaluate(prompt.trim());
    setPrompt("");
  };

  const handleBatchConfirmYes = async () => {
    setBatchConfirm(false);
    await runBatch();
  };

  const handleBatchConfirmNo = async () => {
    setBatchConfirm(false);
    await evaluate(prompt.trim());
    setPrompt("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (batch) return;
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canEvaluate) {
      handleSubmit();
    }
  };

  const lineCount = batch ? prompt.split("\n").filter((l) => l.trim()).length : 0;
  const isRunning = evalLoading || !!batchProgress;

  return (
    <div className="p-4" style={{ borderBottom: '1px solid var(--sub-rivet)' }}>
      <div className="flex items-center justify-between mb-2">
        <label className="text-sm font-medium" style={{ color: 'var(--sub-text)' }}>
          {batch ? "Batch Prompt" : "Prompt"}
        </label>
        <button
          onClick={() => setBatch(!batch)}
          disabled={isRunning}
          className="text-[10px] font-mono px-2 py-0.5 rounded border transition-colors disabled:opacity-50"
          style={{ borderColor: 'var(--sub-rivet)', color: batch ? 'var(--sub-brass)' : 'var(--sub-text-dim)' }}
        >
          {batch ? "batch" : "single"}
        </button>
      </div>
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={batch ? "One prompt per line..." : "Ask a question that exercises the MCP tools..."}
        disabled={!connected || isRunning}
        rows={10}
        className="w-full px-3 py-2 input-sub border rounded-lg focus:outline-none resize-none disabled:opacity-50"
      />

      {/* Batch confirmation */}
      {batchConfirm && (
        <div
          className="mt-2 p-3 rounded-lg text-sm flex items-center justify-between"
          style={{ backgroundColor: 'rgba(196,154,42,0.1)', border: '1px solid var(--sub-brass)' }}
        >
          <span style={{ color: 'var(--sub-text)' }}>
            This looks like {prompt.split("\n").filter((l) => l.trim()).length} separate prompts. Run as batch?
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={handleBatchConfirmYes}
              className="px-3 py-1 text-xs font-medium rounded btn-brass"
            >
              Yes, batch
            </button>
            <button
              onClick={handleBatchConfirmNo}
              className="px-3 py-1 text-xs font-medium rounded"
              style={{ color: 'var(--sub-text-dim)' }}
            >
              No, single
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mt-2">
        <span className="text-xs" style={{ color: 'var(--sub-text-dim)' }}>
          {batchProgress
            ? `Running prompt ${batchProgress.current}/${batchProgress.total}...`
            : evalLoading
              ? "LLM is working..."
              : batch
                ? `${lineCount} prompt${lineCount !== 1 ? "s" : ""}`
                : "Cmd+Enter to evaluate"}
        </span>
        <button
          onClick={handleSubmit}
          disabled={!canEvaluate}
          className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-colors ${
            canEvaluate ? "btn-brass" : ""
          }`}
          style={!canEvaluate ? { backgroundColor: 'var(--sub-panel-light)', color: 'var(--sub-text-dim)' } : {}}
        >
          {isRunning ? (
            <span className="flex items-center gap-2">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              {batchProgress ? `${batchProgress.current}/${batchProgress.total}` : "Evaluating..."}
            </span>
          ) : (
            batch ? `Evaluate ${lineCount > 0 ? `(${lineCount})` : ""}` : "Evaluate"
          )}
        </button>
      </div>
    </div>
  );
}
