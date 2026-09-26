import { useMemo } from "react";
import { useStore } from "../../store";
import { flattenParamStore } from "../../utils/params";
import { SchemaForm } from "../shared/SchemaForm";
import { JsonViewer } from "../shared/JsonViewer";

export function PromptDetail() {
  const selection = useStore((s) => s.selection);
  const getPrompt = useStore((s) => s.getPrompt);
  const result = useStore((s) => s.result);
  const resultLoading = useStore((s) => s.resultLoading);
  const parameterStore = useStore((s) => s.parameterStore);
  const harvestParams = useStore((s) => s.harvestParams);
  const prompt = selection?.item;

  const flatParams = useMemo(() => flattenParamStore(parameterStore), [parameterStore]);

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

  const handleSubmit = (args: Record<string, unknown>) => {
    harvestParams(args);
    // Prompt arguments are strings; autofilled values may be numbers or booleans
    const stringArgs: Record<string, string> = {};
    for (const [k, v] of Object.entries(args)) stringArgs[k] = String(v);
    getPrompt(prompt.name, stringArgs);
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
          initialValues={flatParams}
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
