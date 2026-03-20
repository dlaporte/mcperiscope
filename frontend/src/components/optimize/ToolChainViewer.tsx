import { useState } from "react";
import Markdown from "react-markdown";
import { useStore } from "../../store";

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
    '<span style="color:#93c5fd">$1</span>:'
  ).replace(
    /:\s*("(?:\\.|[^"\\])*")/g,
    ': <span style="color:#86efac">$1</span>'
  ).replace(
    /:\s*(true|false)/g,
    ': <span style="color:#fbbf24">$1</span>'
  ).replace(
    /:\s*(\d+\.?\d*)/g,
    ': <span style="color:#c4b5fd">$1</span>'
  ).replace(
    /:\s*(null)/g,
    ': <span style="color:#6b7280">$1</span>'
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
        className="text-xs text-gray-400 hover:text-gray-200 flex items-center gap-1"
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
          <span className="text-gray-600 ml-1">({text.length} chars)</span>
        )}
      </button>
      {open && (
        <pre
          className="mt-1 p-2 bg-gray-950 rounded text-xs text-green-300 overflow-x-auto max-h-64 overflow-y-auto whitespace-pre-wrap break-words font-mono"
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
          className={`w-3 h-3 rounded-full flex-shrink-0 mt-1.5 ${
            hasError ? "bg-red-500" : "bg-blue-500"
          }`}
        />
        {!isLast && <div className="w-0.5 flex-1 bg-gray-700 mt-1" />}
      </div>

      {/* Card */}
      <div
        className={`flex-1 mb-3 p-3 rounded-lg border ${
          hasError
            ? "bg-red-950/30 border-red-800"
            : "bg-gray-800 border-gray-700"
        }`}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">#{step.step}</span>
            <span className="text-sm font-mono font-medium text-blue-300">
              {step.tool}
            </span>
          </div>
          {isLoading ? (
            <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          ) : (
            <span
              className={`text-xs px-2 py-0.5 rounded-full ${
                step.duration > 2
                  ? "bg-yellow-900 text-yellow-300"
                  : "bg-gray-700 text-gray-300"
              }`}
            >
              {step.duration}s
            </span>
          )}
        </div>

        {hasError && (
          <div className="mt-2 text-xs text-red-400 bg-red-950/50 p-2 rounded">
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
        <p className="text-gray-500">Select an evaluation to view its tool chain</p>
      </div>
    );
  }

  const evalResult = evalResults[selectedEvalIndex];
  const toolChain: ToolChainStep[] = evalResult.toolChain;

  return (
    <div className="flex-1 overflow-y-auto p-4">
      {/* Prompt header */}
      <div className="mb-4 p-3 bg-gray-800/50 rounded-lg border border-gray-700">
        <span className="text-xs text-gray-500 uppercase tracking-wider">Prompt</span>
        <p className="text-sm text-gray-200 mt-1">{evalResult.prompt}</p>
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
        <div className="mb-4 text-sm text-gray-500 italic">
          No tool calls were made
        </div>
      )}

      {/* Final answer */}
      {evalResult.answer ? (
        <div className="p-4 rounded-lg border-2 border-green-800 bg-green-950/20">
          <span className="text-xs text-green-400 uppercase tracking-wider font-medium">
            Final Answer
          </span>
          <div className="mt-2 text-sm text-gray-200 prose prose-sm prose-invert max-w-none">
            <Markdown>{evalResult.answer}</Markdown>
          </div>
        </div>
      ) : (
        <div className="p-4 rounded-lg border-2 border-gray-700 bg-gray-800/50 flex items-center gap-3">
          <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-gray-400">LLM is working...</span>
        </div>
      )}
    </div>
  );
}
