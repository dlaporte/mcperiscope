// Rough client-side token estimate: ~4 characters per token
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// Menu-item estimates count at least one token per piece of text
function estimateAtLeastOne(text: string): number {
  return Math.max(1, estimateTokens(text));
}

export function estimateToolTokens(tool: any): number {
  const desc = tool.description || "";
  const schema = JSON.stringify(tool.inputSchema || {});
  return estimateAtLeastOne(`${tool.name}: ${desc}`) + estimateAtLeastOne(schema);
}

export function estimateResourceTokens(resource: any): number {
  return estimateAtLeastOne(`${resource.name || ""}: ${resource.description || ""} (${resource.uri || ""})`);
}

export function estimatePromptTokens(prompt: any): number {
  const args = (prompt.arguments || []).map((a: any) => a.name).join(", ");
  return estimateAtLeastOne(`${prompt.name}(${args}): ${prompt.description || ""}`);
}
