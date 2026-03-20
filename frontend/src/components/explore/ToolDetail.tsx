import { useEffect } from "react";
import { useStore } from "../../store";
import { SchemaForm } from "../shared/SchemaForm";
import { JsonViewer } from "../shared/JsonViewer";
import { ToolStats } from "./ToolStats";

export function ToolDetail() {
  const { selection, callTool, result, resultLoading, parameterStore, harvestParams, harvestResultParams } = useStore();
  const tool = selection?.item;

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
        <h2 className="text-lg font-bold text-white">{tool.name}</h2>
        {tool.description && (
          <p className="text-gray-400 text-sm mt-1">{tool.description}</p>
        )}
      </div>

      <ToolStats toolName={tool.name} />

      <div>
        <h3 className="text-sm font-semibold text-gray-300 mb-2">
          Parameters
        </h3>
        <SchemaForm
          key={tool.name}
          schema={tool.inputSchema || {}}
          onSubmit={handleSubmit}
          submitLabel="Invoke Tool"
          loading={resultLoading}
          initialValues={parameterStore}
        />
      </div>

      {result && (
        <div>
          <h3 className="text-sm font-semibold text-gray-300 mb-2">Result</h3>
          <JsonViewer data={result} />
        </div>
      )}
    </div>
  );
}
