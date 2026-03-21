import { useState, useEffect, useMemo } from "react";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function syntaxHighlightJson(jsonStr: string): string {
  const escaped = escapeHtml(jsonStr);
  return escaped
    .replace(
      /(&quot;(?:[^&]|&amp;)*?&quot;)\s*:/g,
      '<span style="color:var(--sub-brass)">$1</span>:'
    )
    .replace(
      /:\s*(&quot;(?:[^&]|&amp;)*?&quot;)/g,
      ': <span style="color:var(--sub-phosphor)">$1</span>'
    )
    .replace(
      /:\s*(true|false)/g,
      ': <span style="color:var(--sub-brass)">$1</span>'
    )
    .replace(
      /:\s*(\d+\.?\d*)/g,
      ': <span style="color:#c4b5fd">$1</span>'
    )
    .replace(
      /:\s*(null)/g,
      ': <span style="color:var(--sub-text-dim)">$1</span>'
    );
}

function formatMessageContent(content: string): string {
  // Split content into sections by [Tool Call:] and [Tool Result:] markers
  const sections = content.split(/(\[Tool (?:Call|Result): [^\]]+\])/g);

  const htmlParts: string[] = [];
  for (const section of sections) {
    // Tool call header
    const callMatch = section.match(/^\[Tool Call: ([^\]]+)\]$/);
    if (callMatch) {
      htmlParts.push(
        `<div style="margin-top:12px;margin-bottom:4px;color:var(--sub-brass);font-weight:600">⚡ Tool Call: ${escapeHtml(callMatch[1])}</div>`
      );
      continue;
    }

    // Tool result header
    const resultMatch = section.match(/^\[Tool Result: ([^\]]+)\]$/);
    if (resultMatch) {
      htmlParts.push(
        `<div style="margin-top:12px;margin-bottom:4px;color:var(--sub-phosphor);font-weight:600">← Tool Result: ${escapeHtml(resultMatch[1])}</div>`
      );
      continue;
    }

    // Try to parse as JSON and pretty-print
    const trimmed = section.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed);
        const pretty = JSON.stringify(parsed, null, 2);
        htmlParts.push(
          `<div style="background:var(--sub-panel);border:1px solid var(--sub-rivet);border-radius:4px;padding:8px;margin:4px 0;overflow-x:auto">${syntaxHighlightJson(pretty)}</div>`
        );
        continue;
      } catch { /* not valid JSON, fall through */ }
    }

    // Plain text
    if (trimmed) {
      htmlParts.push(`<div style="margin:4px 0">${escapeHtml(trimmed)}</div>`);
    }
  }

  return htmlParts.join("");
}

interface ContextData {
  tools: Array<{ name: string; description: string }>;
  tool_count: number;
  messages: Array<{ role: string; content: string }>;
  message_count: number;
}

interface Props {
  evalIndex: number;
  totalTokens: number;
  onClose: () => void;
}

export function ContextModal({ evalIndex, totalTokens, onClose }: Props) {
  const [context, setContext] = useState<ContextData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<"messages" | "tools">("messages");

  // Estimate tokens using the API-reported total to calibrate
  // The API wraps tools and messages with overhead, so we calculate proportional shares
  const { messageTokens, toolTokens } = useMemo(() => {
    if (!context) return { messageTokens: 0, toolTokens: 0 };

    // Calculate raw char counts for proportional split
    const msgChars = context.messages.reduce((sum, m) => {
      const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
      return sum + content.length;
    }, 0);

    const toolChars = context.tools.reduce((sum, t) => {
      return sum + `${t.name}: ${t.description}`.length;
    }, 0);

    const totalChars = msgChars + toolChars;
    if (totalChars === 0) return { messageTokens: 0, toolTokens: 0 };

    // Use the API-reported total to split proportionally
    const msgRatio = msgChars / totalChars;
    const toolRatio = toolChars / totalChars;

    return {
      messageTokens: Math.round(totalTokens * msgRatio),
      toolTokens: Math.round(totalTokens * toolRatio),
    };
  }, [context, totalTokens]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/optimize/context/${evalIndex}`)
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Failed to load");
        return res.json();
      })
      .then(setContext)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [evalIndex]);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50"
        style={{ backgroundColor: "rgba(0,0,0,0.6)" }}
        onClick={onClose}
      />

      {/* Modal */}
      <div
        className="fixed inset-8 z-50 flex flex-col rounded-lg overflow-hidden"
        style={{ backgroundColor: "var(--sub-hull)", border: "1px solid var(--sub-rivet)" }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-3 shrink-0"
          style={{ borderBottom: "1px solid var(--sub-rivet)", backgroundColor: "var(--sub-panel)" }}
        >
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3">
              <h2 className="font-stencil text-sm" style={{ color: "var(--sub-text)" }}>
                Context Window
              </h2>
              <span className="text-xs font-mono phosphor-text">
                {totalTokens.toLocaleString()} tokens
              </span>
            </div>
            {context && (
              <div className="flex gap-2">
                <button
                  onClick={() => setActiveSection("messages")}
                  className="flex items-center gap-1.5 px-3 py-1 text-xs rounded"
                  style={
                    activeSection === "messages"
                      ? { backgroundColor: "var(--sub-brass)", color: "#1a1a1a", fontWeight: 700 }
                      : { color: "var(--sub-text-dim)" }
                  }
                >
                  Messages
                  <span
                    className="text-[10px] font-mono px-1.5 rounded-full"
                    style={
                      activeSection === "messages"
                        ? { backgroundColor: "rgba(0,0,0,0.2)", color: "#1a1a1a" }
                        : { backgroundColor: "var(--sub-panel-light)", color: "var(--sub-text-dim)" }
                    }
                  >
                    ~{messageTokens.toLocaleString()} tok
                  </span>
                </button>
                <button
                  onClick={() => setActiveSection("tools")}
                  className="flex items-center gap-1.5 px-3 py-1 text-xs rounded"
                  style={
                    activeSection === "tools"
                      ? { backgroundColor: "var(--sub-brass)", color: "#1a1a1a", fontWeight: 700 }
                      : { color: "var(--sub-text-dim)" }
                  }
                >
                  Tools
                  <span
                    className="text-[10px] font-mono px-1.5 rounded-full"
                    style={
                      activeSection === "tools"
                        ? { backgroundColor: "rgba(0,0,0,0.2)", color: "#1a1a1a" }
                        : { backgroundColor: "var(--sub-panel-light)", color: "var(--sub-text-dim)" }
                    }
                  >
                    ~{toolTokens.toLocaleString()} tok
                  </span>
                </button>
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-lg leading-none px-2"
            style={{ color: "var(--sub-text-dim)" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--sub-text)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--sub-text-dim)")}
          >
            &times;
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {loading && (
            <div className="flex items-center justify-center h-full">
              <div
                className="w-6 h-6 border-2 rounded-full animate-spin"
                style={{ borderColor: "var(--sub-brass)", borderTopColor: "transparent" }}
              />
            </div>
          )}

          {error && (
            <div className="flex items-center justify-center h-full">
              <p className="alarm-text">{error}</p>
            </div>
          )}

          {context && activeSection === "messages" && (
            <div className="space-y-3">
              {context.messages.map((msg, i) => (
                <div key={i} className="flex gap-3">
                  <div className="shrink-0 mt-1">
                    <span
                      className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded"
                      style={
                        msg.role === "user"
                          ? { backgroundColor: "rgba(196,154,42,0.2)", color: "var(--sub-brass)" }
                          : { backgroundColor: "rgba(48,204,48,0.15)", color: "var(--sub-phosphor)" }
                      }
                    >
                      {msg.role}
                    </span>
                  </div>
                  <div
                    className="flex-1 text-xs font-mono whitespace-pre-wrap break-words p-3 rounded overflow-auto"
                    style={{
                      backgroundColor: "var(--sub-panel)",
                      color: "var(--sub-text)",
                      border: "1px solid var(--sub-rivet)",
                    }}
                    dangerouslySetInnerHTML={{
                      __html: formatMessageContent(
                        typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content, null, 2)
                      ),
                    }}
                  />
                </div>
              ))}
              {context.messages.length === 0 && (
                <p className="text-sm" style={{ color: "var(--sub-text-dim)" }}>
                  No messages yet
                </p>
              )}
            </div>
          )}

          {context && activeSection === "tools" && (
            <table className="w-full text-xs">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--sub-rivet)" }}>
                  <th className="text-left px-3 py-2 font-semibold font-stencil" style={{ color: "var(--sub-text-dim)", width: "250px" }}>Name</th>
                  <th className="text-left px-3 py-2 font-semibold font-stencil" style={{ color: "var(--sub-text-dim)" }}>Description</th>
                </tr>
              </thead>
              <tbody>
                {context.tools.map((tool, i) => (
                  <tr
                    key={i}
                    style={{
                      backgroundColor: i % 2 === 0 ? "var(--sub-panel)" : "transparent",
                      borderBottom: "1px solid rgba(74,78,80,0.3)",
                    }}
                  >
                    <td className="px-3 py-2 font-mono phosphor-text align-top" style={{ width: "250px" }}>
                      {tool.name}
                    </td>
                    <td className="px-3 py-2 align-top" style={{ color: "var(--sub-text-dim)" }}>
                      {tool.description}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

      </div>
    </>
  );
}
