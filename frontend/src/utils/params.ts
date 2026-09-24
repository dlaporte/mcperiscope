import type { ParamEntry } from "../store";

// "key: value, ..." summary of the scalar sibling fields an entry was harvested with.
// omitValue skips fields equal to the entry's own value (redundant in a value picker).
export function formatParamContext(entry: ParamEntry, { omitValue = false } = {}): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(entry.context)) {
    if (typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") continue;
    if (omitValue && String(v) === String(entry.value)) continue;
    parts.push(`${k}: ${v}`);
  }
  return parts.join(", ");
}
