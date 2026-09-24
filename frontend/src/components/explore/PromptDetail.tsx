import { useEffect, useMemo } from "react";
import { useStore } from "../../store";
import { SchemaForm } from "../shared/SchemaForm";
import { JsonViewer } from "../shared/JsonViewer";

export function PromptDetail() {
  const { selection, getPrompt, result, resultLoading, parameterStore, harvestParams, harvestResultParams } = useStore();
  const prompt = selection?.item;

  useEffect(() => {
    if (result) harvestResultParams(result);
  }, [result, harvestResultParams]);

  // Build a schema from prompt arguments; memoized so SchemaForm's memos stay stable
  const schema = useMemo(() => {
    const built: any = { type: "object", properties: {}, required: [] };
    for (const arg of prompt?.arguments ?? []) {
      built.properties[arg.name] = {
        type: "string",
        description: arg.description,
      };
      if (arg.required) {
        built.required.push(arg.name);
      }
    }
    return built;
  }, [prompt]);

  if (!prompt) return null;

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
