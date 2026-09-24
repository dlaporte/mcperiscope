export const DEFAULT_MODEL = "claude-sonnet-4-6";

export const KNOWN_MODELS = [
  // Anthropic — latest
  { id: "claude-fable-5-1", label: "Claude Fable 5.1", context: 1000000, provider: "anthropic" as const },
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", context: 1000000, provider: "anthropic" as const },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5", context: 1000000, provider: "anthropic" as const },
  // Anthropic — Claude 4.8
  { id: "claude-opus-4-8", label: "Claude Opus 4.8", context: 1000000, provider: "anthropic" as const },
  // Anthropic — Claude 4.6 family
  { id: "claude-opus-4-6", label: "Claude Opus 4.6", context: 1000000, provider: "anthropic" as const },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", context: 1000000, provider: "anthropic" as const },
  // Anthropic — Claude 4.5 (Haiku 4.5 is the latest Haiku)
  { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", context: 200000, provider: "anthropic" as const },
  // OpenAI — GPT-6 family
  { id: "gpt-6-astra", label: "GPT-6 Astra", context: 1000000, provider: "openai" as const },
  { id: "gpt-6-sol", label: "GPT-6 Sol", context: 1000000, provider: "openai" as const },
  { id: "gpt-6-luna", label: "GPT-6 Luna", context: 1000000, provider: "openai" as const },
  // OpenAI — GPT-5.x family
  { id: "gpt-5.6-terra", label: "GPT-5.6 Terra", context: 1000000, provider: "openai" as const },
  { id: "gpt-5.6-luna", label: "GPT-5.6 Luna", context: 1000000, provider: "openai" as const },
  { id: "gpt-5.4", label: "GPT-5.4", context: 1000000, provider: "openai" as const },
  { id: "gpt-5.4-mini", label: "GPT-5.4 Mini", context: 400000, provider: "openai" as const },
  { id: "gpt-5.2", label: "GPT-5.2", context: 400000, provider: "openai" as const },
  // OpenAI — GPT-4o family
  { id: "gpt-4o", label: "GPT-4o", context: 128000, provider: "openai" as const },
  { id: "gpt-4o-mini", label: "GPT-4o Mini", context: 128000, provider: "openai" as const },
];

// Context window per known model id
export const MODEL_CONTEXT: Record<string, number> = Object.fromEntries(
  KNOWN_MODELS.map((m) => [m.id, m.context])
);
