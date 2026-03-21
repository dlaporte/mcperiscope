import { useStore } from "../../store";

const MODELS = [
  // Anthropic — Claude 4.6 family (latest)
  { id: "claude-opus-4-6", label: "Claude Opus 4.6", context: 1000000, provider: "anthropic" },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", context: 1000000, provider: "anthropic" },
  // Anthropic — Claude 4.5
  { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", context: 200000, provider: "anthropic" },
  // OpenAI — GPT-5.x family
  { id: "gpt-5.4", label: "GPT-5.4", context: 1000000, provider: "openai" },
  { id: "gpt-5.4-mini", label: "GPT-5.4 Mini", context: 400000, provider: "openai" },
  { id: "gpt-5.2", label: "GPT-5.2", context: 400000, provider: "openai" },
  // OpenAI — GPT-4o family
  { id: "gpt-4o", label: "GPT-4o", context: 128000, provider: "openai" },
  { id: "gpt-4o-mini", label: "GPT-4o Mini", context: 128000, provider: "openai" },
];

function formatContext(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`;
}

function detectProvider(apiKey: string): string | null {
  if (!apiKey) return null;
  if (apiKey.startsWith("sk-ant-")) return "anthropic";
  if (apiKey.startsWith("sk-")) return "openai";
  return null;
}

export function ModelConfig() {
  const { model, apiKey, setModel, setApiKey, connected, connecting } = useStore();

  const disabled = connected || connecting;
  const detectedProvider = detectProvider(apiKey);
  const selectedModel = MODELS.find((m) => m.id === model);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          disabled={disabled}
          className="input-sub border rounded-lg px-2 py-2 text-sm disabled:opacity-50 flex-1"
        >
          <optgroup label="Anthropic">
            {MODELS.filter((m) => m.provider === "anthropic").map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} ({formatContext(m.context)} ctx)
              </option>
            ))}
          </optgroup>
          <optgroup label="OpenAI">
            {MODELS.filter((m) => m.provider === "openai").map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} ({formatContext(m.context)} ctx)
              </option>
            ))}
          </optgroup>
        </select>
        {selectedModel && (
          <span className="text-xs whitespace-nowrap" style={{ color: 'var(--sub-text-dim)' }}>
            {selectedModel.provider}
          </span>
        )}
      </div>

      <div className="relative">
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="API key (sk-...)"
          disabled={disabled}
          className="w-full input-sub border rounded-lg px-3 py-2 text-sm  disabled:opacity-50"
        />
        {detectedProvider && (
          <span
            className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] px-1.5 py-0.5 rounded"
            style={{ backgroundColor: 'var(--sub-panel-light)', color: 'var(--sub-text-dim)' }}
          >
            {detectedProvider}
          </span>
        )}
      </div>

      {detectedProvider && selectedModel && detectedProvider !== selectedModel.provider && (
        <p className="text-xs" style={{ color: 'var(--sub-brass)' }}>
          API key looks like {detectedProvider} but selected model is {selectedModel.provider}
        </p>
      )}
    </div>
  );
}
