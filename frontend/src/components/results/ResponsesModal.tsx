import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface Props {
  proxyAnswers: Array<{ prompt: string; answer: string }>;
  evalResults: Array<{ prompt: string; answer: string }>;
  onClose: () => void;
}

export function ResponsesModal({ proxyAnswers, evalResults, onClose }: Props) {
  // Build a merged list keyed by prompt
  const prompts = proxyAnswers.map((pa) => {
    const baseline = evalResults.find((er) => er.prompt === pa.prompt);
    return {
      prompt: pa.prompt,
      baselineAnswer: baseline?.answer || "",
      optimizedAnswer: pa.answer,
    };
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="relative w-full max-w-4xl max-h-[90vh] flex flex-col rounded-lg overflow-hidden"
        style={{ backgroundColor: 'var(--sub-panel)', border: '1px solid var(--sub-rivet)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 shrink-0" style={{ borderBottom: '1px solid var(--sub-rivet)' }}>
          <h3 className="text-lg font-semibold font-stencil" style={{ color: 'var(--sub-text)' }}>
            Responses
          </h3>
          <button
            onClick={onClose}
            className="text-lg px-2 py-0.5 rounded hover:opacity-80"
            style={{ color: 'var(--sub-text-dim)' }}
          >
            &#x2715;
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {prompts.length === 0 && (
            <p className="text-sm" style={{ color: 'var(--sub-text-dim)' }}>No responses to display.</p>
          )}
          {prompts.map((item, i) => (
            <div key={i} className="panel-riveted rounded-lg overflow-hidden">
              {/* Prompt */}
              <div className="px-4 py-2" style={{ borderBottom: '1px solid var(--sub-rivet)' }}>
                <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--sub-text-dim)' }}>
                  Prompt
                </span>
                <p className="text-sm mt-0.5" style={{ color: 'var(--sub-text)' }}>{item.prompt}</p>
              </div>

              {/* Two columns */}
              <div className="grid grid-cols-2 gap-0">
                <div className="p-3" style={{ borderRight: '1px solid var(--sub-rivet)' }}>
                  <div className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--sub-text-dim)' }}>
                    Baseline
                  </div>
                  <div
                    className="p-3 rounded text-xs overflow-auto max-h-64 prose prose-sm prose-invert max-w-none"
                    style={{ backgroundColor: 'var(--sub-hull)', border: '1px solid var(--sub-rivet)' }}
                  >
                    <Markdown remarkPlugins={[remarkGfm]}>{item.baselineAnswer || "No response"}</Markdown>
                  </div>
                </div>
                <div className="p-3">
                  <div className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--sub-text-dim)' }}>
                    Optimized
                  </div>
                  <div
                    className="p-3 rounded text-xs overflow-auto max-h-64 prose prose-sm prose-invert max-w-none"
                    style={{ backgroundColor: 'var(--sub-hull)', border: '1px solid var(--sub-rivet)' }}
                  >
                    <Markdown remarkPlugins={[remarkGfm]}>{item.optimizedAnswer || "No response"}</Markdown>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
