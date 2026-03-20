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

  if (!prompt) return null;

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
        <h2 className="text-lg font-bold text-white">{prompt.name}</h2>
        {prompt.description && (
          <p className="text-gray-400 text-sm mt-1">{prompt.description}</p>
        )}
      </div>

      <div>
        <h3 className="text-sm font-semibold text-gray-300 mb-2">Arguments</h3>
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
          <h3 className="text-sm font-semibold text-gray-300 mb-2">
            Prompt Messages
          </h3>
          <JsonViewer data={result} />
        </div>
      )}
    </div>
  );
}
