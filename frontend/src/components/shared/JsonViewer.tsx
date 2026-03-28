import { useState } from "react";
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
 * instead of \n escapes. Long strings are indented to their context level.
 */
function prettyPrintJson(data: unknown): string {
  const raw = JSON.stringify(data, null, 2);
  // Replace JSON-escaped strings that contain \n with block-indented text.
  // Match: "<content with \n>" sitting at some indentation level.
  return raw.replace(/^( *)"((?:[^"\\]|\\.)*)"/gm, (_match, indent: string, content: string) => {
    // Only process strings that actually contain escaped newlines
    if (!content.includes("\\n")) return _match;
    // Unescape the JSON string content
    const unescaped = content
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
    // If it's a single line after unescape, keep it inline
    if (!unescaped.includes("\n")) return `${indent}"${unescaped}"`;
    // Indent each continuation line to align with the opening quote
    const pad = indent + "  ";
    const lines = unescaped.split("\n");
    return `${indent}"${lines.join("\n" + pad)}"`;
  });
}

function highlightJson(jsonStr: string): React.ReactNode {
  // Split into tokens: strings, numbers, booleans, null, punctuation
  const parts: React.ReactNode[] = [];
  let keyIndex = 0;

  // Use regex to tokenize
  const tokenRegex = /("(?:[^"\\]|\\.)*")|(\b(?:true|false|null)\b)|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([{}\[\],:])/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let isKey = true; // Track if next string is a key

  while ((match = tokenRegex.exec(jsonStr)) !== null) {
    // Add any whitespace/text before this match
    if (match.index > lastIndex) {
      parts.push(jsonStr.slice(lastIndex, match.index));
    }

    const [full, str, keyword, num, punct] = match;

    if (str !== undefined) {
      // Determine if this is a key (preceded by { or , at same level) or value
      const color = isKey ? 'var(--sub-brass)' : 'var(--sub-phosphor)';
      parts.push(<span key={keyIndex++} style={{ color }}>{full}</span>);
      isKey = false;
    } else if (keyword !== undefined) {
      parts.push(<span key={keyIndex++} style={{ color: '#6495ed' }}>{full}</span>);
      isKey = false;
    } else if (num !== undefined) {
      parts.push(<span key={keyIndex++} style={{ color: '#6495ed' }}>{full}</span>);
      isKey = false;
    } else if (punct !== undefined) {
      parts.push(<span key={keyIndex++} style={{ color: 'var(--sub-text-dim)' }}>{full}</span>);
      if (full === ':') isKey = false;
      else if (full === ',' || full === '{' || full === '[') isKey = true;
    }

    lastIndex = match.index + full.length;
  }

  // Add remaining text
  if (lastIndex < jsonStr.length) {
    parts.push(jsonStr.slice(lastIndex));
  }

  return parts;
}

export function JsonViewer({ data }: Props) {
  const [formatted, setFormatted] = useState(false);
  const extracted = extractTextContent(data);
  const prettyData = deepParseJsonStrings(data);
  const showToggle = extracted?.isMarkdown ?? false;

  return (
    <div>
      {showToggle && (
        <div className="mb-2">
          <button
            type="button"
            onClick={() => setFormatted(!formatted)}
            className="text-xs px-2 py-1 rounded border transition-colors"
            style={{ borderColor: 'var(--sub-rivet)', color: 'var(--sub-text)' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = 'var(--sub-text-bright)';
              e.currentTarget.style.borderColor = 'var(--sub-brass-dim)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'var(--sub-text)';
              e.currentTarget.style.borderColor = 'var(--sub-rivet)';
            }}
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
        <pre className="sonar-screen p-4 rounded-lg overflow-auto text-sm max-h-[600px]">
          {highlightJson(prettyPrintJson(prettyData))}
        </pre>
      )}
    </div>
  );
}
