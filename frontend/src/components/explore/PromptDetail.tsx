import { useEffect } from "react";
import { useStore } from "../../store";
import { SchemaForm } from "../shared/SchemaForm";
import { JsonViewer } from "../shared/JsonViewer";

export function PromptDetail() {
  const { selection, getPrompt, result, resultLoading, parameterStore, harvestParams, harvestResultParams } = useStore();
  const prompt = selection?.item;

  useEffect(() => {
    if (result) harvestResultParams(result);
  }, [result, harvestResultParams]);

  if (!prompt) return (
  <div className="flex items-center justify-center h-full" style={{ color: 'var(--sub-text-dim)' }}>
    <p className="text-sm">Select a prompt from the sidebar to view and test it.</p>
  </div>
);

  // Build a schema from prompt arguments
  const schema: any = { type: "object", properties: {}, required: [] };
  if (prompt.arguments) {
    for (const arg of prompt.arguments) {
      schema.properties[arg.name] = {
        type: "string",
        description: arg.description,
      };
      if (arg.required) {
        schema.required.push(arg.name);
      }
    }
  }

  const handleSubmit = (args: Record<string, string>) => {
    harvestParams(args);
    getPrompt(prompt.name, args as Record<string, string>);
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold font-stencil" style={{ color: 'var(--sub-text)' }}>{prompt.name}</h2>
        {prompt.description && (
          <p className="text-sm mt-1" style={{ color: 'var(--sub-text-dim)' }}>{prompt.description}</p>
        )}
      </div>

      <div>
        <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--sub-text)' }}>Arguments</h3>
        <SchemaForm
          key={prompt.name}
          schema={schema}
          onSubmit={handleSubmit}
          submitLabel="Get Prompt"
          loading={resultLoading}
          initialValues={parameterStore}
        />
      </div>

      {result && (
        <div>
          <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--sub-text)' }}>
            Prompt Messages
          </h3>
          <JsonViewer data={result} />
        </div>
      )}
    </div>
  );
}
