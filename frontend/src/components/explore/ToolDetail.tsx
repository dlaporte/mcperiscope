import { useEffect, useMemo } from "react";
import { useStore } from "../../store";
import type { ParamEntry } from "../../store";
import { SchemaForm } from "../shared/SchemaForm";
import { JsonViewer } from "../shared/JsonViewer";
import { ToolStats } from "./ToolStats";

/** Flatten multi-value param store to simple key→value using first entry per key */
function flattenParamStore(store: Record<string, ParamEntry[]>): Record<string, unknown> {
  const flat: Record<string, unknown> = {};
  for (const [key, entries] of Object.entries(store)) {
    if (entries.length > 0) {
      flat[key] = entries[0].value;
    }
  }
  return flat;
}

/** Patterns that suggest a field is trimmable (internal/audit data an LLM doesn't need).
 *  Deliberately excludes identifiers (GUIDs, UUIDs, IDs) since those are often
 *  foreign keys used to chain tool calls together. */
const TRIMMABLE_PATTERNS = [
  /^_/,                          // underscore-prefixed internal fields
  /^__/,                         // double-underscore internal fields
  /created[_-]?(at|date|on|time)/i,
  /updated[_-]?(at|date|on|time)/i,
  /modified[_-]?(at|date|on|time)/i,
  /deleted[_-]?(at|date|on|time)/i,
  /^audit/i,
  /^internal[_-]/i,
  /^raw[_-]/i,
  /^etag$/i,
  /^checksum$/i,
  /^hash$/i,
  /^meta(data)?$/i,
  /^(row|record)[_-]?version/i,
  /^sort[_-]?order$/i,
  /^display[_-]?order$/i,
  /^cache[_-]/i,
  /^legacy[_-]/i,
  /^deprecated[_-]/i,
];

function isTrimmable(key: string): boolean {
  return TRIMMABLE_PATTERNS.some((p) => p.test(key));
}

/** Analyze result for trimmable fields */
function findTrimmableFields(data: unknown): string[] {
  const trimmable: string[] = [];

  function scan(obj: unknown) {
    if (!obj || typeof obj !== "object") return;
    if (Array.isArray(obj)) {
      if (obj.length > 0 && typeof obj[0] === "object") scan(obj[0]);
      return;
    }
    for (const key of Object.keys(obj as Record<string, unknown>)) {
      if (isTrimmable(key)) trimmable.push(key);
    }
  }

  // Extract from MCP result shape
  const content = (data as any)?.content;
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block?.text) {
        try {
          const parsed = JSON.parse(block.text);
          scan(parsed);
        } catch { /* not JSON */ }
      }
    }
  }

  return [...new Set(trimmable)];
}

export function ToolDetail() {
  const { selection, callTool, result, resultLoading, resultMeta, parameterStore, harvestParams, harvestResultParams } = useStore();
  const tool = selection?.item;

  const flatParams = useMemo(() => flattenParamStore(parameterStore), [parameterStore]);

  useEffect(() => {
    if (result) harvestResultParams(result);
  }, [result, harvestResultParams]);

  const trimmableFields = useMemo(() => (result ? findTrimmableFields(result) : []), [result]);

  if (!tool) return null;

  const handleSubmit = (args: Record<string, unknown>) => {
    harvestParams(args);
    callTool(tool.name, args);
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold font-stencil" style={{ color: 'var(--sub-text)' }}>{tool.name}</h2>
        {tool.description && (
          <p className="text-sm mt-1" style={{ color: 'var(--sub-text-dim)' }}>{tool.description}</p>
        )}
      </div>

      <ToolStats toolName={tool.name} />

      <div>
        <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--sub-text)' }}>
          Parameters
        </h3>
        <SchemaForm
          key={tool.name}
          schema={tool.inputSchema || {}}
          onSubmit={handleSubmit}
          submitLabel="Invoke Tool"
          loading={resultLoading}
          initialValues={flatParams}
        />
      </div>

      {result && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold" style={{ color: 'var(--sub-text)' }}>Result</h3>
            {resultMeta && (
              <div className="flex items-center gap-2">
                <span
                  className="text-xs px-2 py-0.5 rounded-full"
                  style={
                    resultMeta.durationMs > 2000
                      ? { backgroundColor: 'rgba(196,154,42,0.2)', color: 'var(--sub-brass)' }
                      : { backgroundColor: 'var(--sub-panel-light)', color: 'var(--sub-text)' }
                  }
                >
                  {(resultMeta.durationMs / 1000).toFixed(1)}s
                </span>
                <span
                  className="text-xs px-2 py-0.5 rounded-full"
                  style={{ backgroundColor: 'var(--sub-panel-light)', color: 'var(--sub-text)' }}
                >
                  ~{resultMeta.tokens.toLocaleString()} tok
                </span>
              </div>
            )}
          </div>
          <JsonViewer data={result} />

          {trimmableFields.length > 0 && (
            <div className="mt-3 p-3 rounded-lg" style={{ backgroundColor: 'rgba(196,154,42,0.1)', border: '1px solid var(--sub-brass-dim)' }}>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-semibold" style={{ color: 'var(--sub-brass)' }}>
                  Potential trim candidates
                </span>
                <span className="text-[10px]" style={{ color: 'var(--sub-text-dim)' }}>
                  These fields may be internal data that the LLM doesn't need
                </span>
              </div>
              <div className="flex flex-wrap gap-1 mt-1">
                {trimmableFields.map((field) => (
                  <span
                    key={field}
                    className="text-[10px] font-mono px-1.5 py-0.5 rounded"
                    style={{ backgroundColor: 'rgba(196,154,42,0.15)', color: 'var(--sub-brass)' }}
                  >
                    {field}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
