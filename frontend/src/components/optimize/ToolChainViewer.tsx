import { useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useStore } from "../../store";

function ToolLink({ name, args }: { name: string; args?: Record<string, unknown> }) {
  const navigateToTool = useStore((s) => s.navigateToTool);
  return (
    <button
      type="button"
      onClick={() => navigateToTool(name, args)}
      className="text-sm font-mono font-medium hover:underline cursor-pointer phosphor-text"
      title="View in Explore tab"
    >
      {name}
    </button>
  );
}

interface ToolChainStep {
  step: number;
  tool: string;
  input: Record<string, unknown>;
  output: string;
  duration: number;
  error: string | null;
}

function syntaxHighlight(json: string): string {
  return json.replace(
    /("(?:\\.|[^"\\])*")\s*:/g,
    '<span style="color:#c49a2a">$1</span>:'
  ).replace(
    /:\s*("(?:\\.|[^"\\])*")/g,
    ': <span style="color:#33ff33">$1</span>'
  ).replace(
    /:\s*(true|false)/g,
    ': <span style="color:#fbbf24">$1</span>'
  ).replace(
    /:\s*(\d+\.?\d*)/g,
    ': <span style="color:#c4b5fd">$1</span>'
  ).replace(
    /:\s*(null)/g,
    ': <span style="color:#7a7a72">$1</span>'
  );
}

function formatData(data: unknown): string {
  if (typeof data === "string") {
    // Try to parse as JSON and pretty-print
    try {
      const parsed = JSON.parse(data);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return data;
    }
  }
  return JSON.stringify(data, null, 2);
}

function CollapsibleJson({
  label,
  data,
  defaultOpen = false,
}: {
  label: string;
  data: unknown;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const text = formatData(data);
  const isLong = text.length > 200;

  return (
    <div className="mt-1">
      <button
        onClick={() => setOpen(!open)}
        className="text-xs flex items-center gap-1"
        style={{ color: 'var(--sub-text-dim)' }}
      >
        <svg
          className={`w-3 h-3 transition-transform ${open ? "rotate-90" : ""}`}
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path
            fillRule="evenodd"
            d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
            clipRule="evenodd"
          />
        </svg>
        {label}
        {!open && isLong && (
          <span className="ml-1" style={{ color: 'var(--sub-text-dim)' }}>({text.length} chars)</span>
        )}
      </button>
      {open && (
        <pre
          className="sonar-screen mt-1 p-2 rounded text-xs overflow-x-auto max-h-64 overflow-y-auto whitespace-pre-wrap break-words font-mono"
          dangerouslySetInnerHTML={{ __html: syntaxHighlight(text) }}
        />
      )}
    </div>
  );
}

function StepCard({ step, isLast }: { step: ToolChainStep; isLast: boolean }) {
  const hasError = !!step.error;
  const isLoading = step.output === "Calling...";

  return (
    <div className="flex gap-3">
      {/* Timeline connector */}
      <div className="flex flex-col items-center">
        <div
          className="w-3 h-3 rounded-full flex-shrink-0 mt-1.5"
          style={{ backgroundColor: hasError ? 'var(--sub-red)' : 'var(--sub-brass)' }}
        />
        {!isLast && <div className="w-0.5 flex-1 mt-1" style={{ backgroundColor: 'var(--sub-rivet)' }} />}
      </div>

      {/* Card */}
      <div
        className={`flex-1 mb-3 p-3 rounded-lg panel-riveted ${
          hasError ? "" : ""
        }`}
        style={hasError ? { borderColor: 'var(--sub-red)', backgroundColor: 'rgba(204,51,51,0.1)' } : {}}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs" style={{ color: 'var(--sub-text-dim)' }}>#{step.step}</span>
            <ToolLink name={step.tool} args={step.input} />
          </div>
          {isLoading ? (
            <div className="w-4 h-4 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--sub-brass)', borderTopColor: 'transparent' }} />
          ) : (
            <span
              className="text-xs px-2 py-0.5 rounded-full"
              style={
                step.duration > 2
                  ? { backgroundColor: 'rgba(196,154,42,0.2)', color: 'var(--sub-brass)' }
                  : { backgroundColor: 'var(--sub-panel-light)', color: 'var(--sub-text)' }
              }
            >
              {step.duration}s
            </span>
          )}
        </div>

        {hasError && (
          <div className="mt-2 alarm-text text-xs p-2 rounded" style={{ backgroundColor: 'rgba(204,51,51,0.15)' }}>
            {step.error}
          </div>
        )}

        <CollapsibleJson label="Input" data={step.input} />
        <CollapsibleJson label="Output" data={step.output} />
      </div>
    </div>
  );
}

export function ToolChainViewer() {
  const evalResults = useStore((s) => s.evalResults);
  const selectedEvalIndex = useStore((s) => s.selectedEvalIndex);

  if (selectedEvalIndex === null || !evalResults[selectedEvalIndex]) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p style={{ color: 'var(--sub-text-dim)' }}>Select an evaluation to view its tool chain</p>
      </div>
    );
  }

  const evalResult = evalResults[selectedEvalIndex];
  const toolChain: ToolChainStep[] = evalResult.toolChain;

  return (
    <div className="flex-1 overflow-y-auto p-4">
      {/* Prompt header */}
      <div className="mb-4 p-3 rounded-lg panel-riveted">
        <span className="font-stencil text-xs uppercase tracking-wider" style={{ color: 'var(--sub-text-dim)' }}>Prompt</span>
        <p className="text-sm mt-1" style={{ color: 'var(--sub-text)' }}>{evalResult.prompt}</p>
      </div>

      {/* Tool chain timeline */}
      {toolChain.length > 0 ? (
        <div className="mb-4">
          {toolChain.map((step, i) => (
            <StepCard
              key={i}
              step={step}
              isLast={i === toolChain.length - 1}
            />
          ))}
        </div>
      ) : (
        <div className="mb-4 text-sm italic" style={{ color: 'var(--sub-text-dim)' }}>
          No tool calls were made
        </div>
      )}

      {/* Final answer */}
      {evalResult.answer ? (
        <div className="p-4 rounded-lg" style={{ border: '2px solid var(--sub-phosphor)', backgroundColor: 'rgba(51,255,51,0.05)' }}>
          <span className="phosphor-text text-xs uppercase tracking-wider font-medium">
            Final Answer
          </span>
          <div className="mt-2 text-sm prose prose-sm prose-invert max-w-none" style={{ color: 'var(--sub-text)' }}>
            <Markdown remarkPlugins={[remarkGfm]}>{evalResult.answer}</Markdown>
          </div>
        </div>
      ) : (
        <div className="p-4 rounded-lg flex items-center gap-3 panel-riveted">
          <div className="w-4 h-4 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--sub-brass)', borderTopColor: 'transparent' }} />
          <span className="text-sm" style={{ color: 'var(--sub-text-dim)' }}>LLM is working...</span>
        </div>
      )}
    </div>
  );
}
