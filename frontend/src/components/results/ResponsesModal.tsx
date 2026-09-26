import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Modal } from "../shared/Modal";

interface Props {
  proxyAnswers: Array<{ index: number; prompt: string; answer: string }>;
  evalResults: Array<{ prompt: string; answer: string; backendIndex?: number }>;
  onClose: () => void;
}

export function ResponsesModal({ proxyAnswers, evalResults, onClose }: Props) {
  // Pair each proxy answer with the baseline eval it re-ran (prompts may repeat)
  const prompts = proxyAnswers.map((pa) => {
    const baseline = evalResults.find((er) => er.backendIndex === pa.index);
    return {
      prompt: pa.prompt,
      baselineAnswer: baseline?.answer || "",
      optimizedAnswer: pa.answer,
    };
  });

  return (
    <Modal
      title="Responses"
      onClose={onClose}
      panelClassName="relative w-full max-w-4xl max-h-[90vh] flex flex-col rounded-lg overflow-hidden"
      panelStyle={{ backgroundColor: 'var(--sub-panel)', border: '1px solid var(--sub-rivet)' }}
    >
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
    </Modal>
  );
}
