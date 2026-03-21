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

export function ToolDetail() {
  const { selection, callTool, result, resultLoading, parameterStore, harvestParams, harvestResultParams } = useStore();
  const tool = selection?.item;

  const flatParams = useMemo(() => flattenParamStore(parameterStore), [parameterStore]);

  useEffect(() => {
    if (result) harvestResultParams(result);
  }, [result, harvestResultParams]);

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
          <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--sub-text)' }}>Result</h3>
          <JsonViewer data={result} />
        </div>
      )}
    </div>
  );
}
