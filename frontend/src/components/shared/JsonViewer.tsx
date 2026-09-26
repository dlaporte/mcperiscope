import { useMemo, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface Props {
  data: unknown;
}

interface ExtractedText {
  text: string;
  isMarkdown: boolean;
}

function extractTextContent(data: unknown): ExtractedText | null {
  if (!data || typeof data !== "object") return null;

  const obj = data as Record<string, unknown>;

  // MCP resource result: { contents: [{ text, mimeType, uri }] }
  if (Array.isArray(obj.contents)) {
    const items = obj.contents.filter((c: any) => typeof c?.text === "string");
    if (items.length > 0) {
      const text = items.map((c: any) => c.text as string).join("\n\n");
      const isMarkdown = items.some(
        (c: any) =>
          c?.mimeType === "text/markdown" ||
          (typeof c?.uri === "string" && c.uri.endsWith(".md"))
      );
      return { text, isMarkdown };
    }
  }

  // MCP tool result: { content: [{ type: "text", text }] }
  if (Array.isArray(obj.content)) {
    const texts = obj.content
      .filter((c: any) => c?.type === "text" && typeof c?.text === "string")
      .map((c: any) => c.text as string);
    if (texts.length > 0) return { text: texts.join("\n\n"), isMarkdown: false };
  }

  // MCP prompt result: { messages: [{ content: { type: "text", text } }] }
  if (Array.isArray(obj.messages)) {
    const texts = obj.messages
      .filter((m: any) => typeof m?.content?.text === "string")
      .map((m: any) => m.content.text as string);
    if (texts.length > 0) return { text: texts.join("\n\n"), isMarkdown: false };
  }

  return null;
}

/**
 * Deep-clone a value, parsing any string that looks like JSON into
 * its parsed form so that JSON.stringify renders it inline instead
 * of showing escaped quotes.
 */
function deepParseJsonStrings(value: unknown): unknown {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    ) {
      try {
        return deepParseJsonStrings(JSON.parse(trimmed));
      } catch {
        return value;
      }
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(deepParseJsonStrings);
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = deepParseJsonStrings(v);
    }
    return out;
  }
  return value;
}

/**
 * Pretty-print JSON with multiline strings rendered as actual newlines
 * instead of \n escapes. Continuation lines are indented to their context level.
 * Everything else matches JSON.stringify(data, null, 2).
 */
function prettyPrintJson(data: unknown): string {
  const json = JSON.stringify(data);
  if (json === undefined) return String(data);
  // Round-trip so the walk sees exactly what JSON.stringify would emit
  // (drops undefined/functions, applies toJSON).
  return formatJsonValue(JSON.parse(json), "");
}

function formatJsonValue(value: unknown, indent: string): string {
  const inner = indent + "  ";
  if (typeof value === "string") {
    if (!value.includes("\n")) return JSON.stringify(value);
    return `"${value.split("\n").join("\n" + inner)}"`;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const items = value.map((v) => inner + formatJsonValue(v, inner));
    return `[\n${items.join(",\n")}\n${indent}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return "{}";
    const items = entries.map(([k, v]) => `${inner}${JSON.stringify(k)}: ${formatJsonValue(v, inner)}`);
    return `{\n${items.join(",\n")}\n${indent}}`;
  }
  return JSON.stringify(value);
}

export function JsonViewer({ data }: Props) {
  const [formatted, setFormatted] = useState(false);
  const extracted = useMemo(() => extractTextContent(data), [data]);
  const pretty = useMemo(() => prettyPrintJson(deepParseJsonStrings(data)), [data]);
  const showToggle = extracted?.isMarkdown ?? false;

  return (
    <div>
      {showToggle && (
        <div className="mb-2">
          <button
            type="button"
            onClick={() => setFormatted(!formatted)}
            className="text-xs px-2 py-1 rounded border transition-colors border-[var(--sub-rivet)] text-[var(--sub-text)] hover:border-[var(--sub-brass-dim)] hover:text-[var(--sub-text-bright)]"
          >
            {formatted ? "Show JSON" : "Show Formatted"}
          </button>
        </div>
      )}

      {formatted && extracted ? (
        <div
          className="p-4 rounded-lg overflow-auto text-sm max-h-[600px] prose prose-invert prose-sm max-w-none"
          style={{ backgroundColor: 'var(--sub-hull)' }}
        >
          <Markdown remarkPlugins={[remarkGfm]}>{extracted.text}</Markdown>
        </div>
      ) : (
        <pre
          className="sonar-screen phosphor-text p-4 rounded-lg overflow-auto text-sm max-h-[600px]"
        >
          {pretty}
        </pre>
      )}
    </div>
  );
}
