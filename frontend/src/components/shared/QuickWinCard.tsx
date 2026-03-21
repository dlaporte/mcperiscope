import { useState } from "react";

export interface QuickWin {
  type: string;
  description: string;
  tools: string[];
  estimated_savings?: number;
}

const TYPE_STYLES: Record<string, React.CSSProperties> = {
  high_tool_count: { backgroundColor: 'rgba(204,51,51,0.2)', color: 'var(--sub-red)' },
  high_context_usage: { backgroundColor: 'rgba(204,51,51,0.2)', color: 'var(--sub-red)' },
  moderate_context_usage: { backgroundColor: 'rgba(196,154,42,0.2)', color: 'var(--sub-brass)' },
  consolidation: { backgroundColor: 'rgba(196,154,42,0.15)', color: 'var(--sub-brass-glow)' },
  duplicate: { backgroundColor: 'rgba(196,154,42,0.2)', color: 'var(--sub-brass)' },
  oversized_schema: { backgroundColor: 'rgba(196,154,42,0.2)', color: 'var(--sub-brass)' },
  missing_description: { backgroundColor: 'rgba(204,51,51,0.2)', color: 'var(--sub-red)' },
  terse_description: { backgroundColor: 'rgba(196,154,42,0.2)', color: 'var(--sub-brass)' },
  no_return_info: { backgroundColor: 'rgba(196,154,42,0.15)', color: 'var(--sub-brass-glow)' },
  duplicate_description: { backgroundColor: 'rgba(196,154,42,0.2)', color: 'var(--sub-brass)' },
  resource_context_usage: { backgroundColor: 'rgba(100,149,237,0.2)', color: '#6495ed' },
  large_resource: { backgroundColor: 'rgba(100,149,237,0.2)', color: '#6495ed' },
  resource_consolidation: { backgroundColor: 'rgba(100,149,237,0.15)', color: '#6495ed' },
};

export function QuickWinCard({ win }: { win: QuickWin }) {
  const [expanded, setExpanded] = useState(false);
  const badgeStyle = TYPE_STYLES[win.type] || { backgroundColor: 'var(--sub-panel-light)', color: 'var(--sub-text-dim)' };

  return (
    <div className="panel-riveted rounded-lg p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded" style={badgeStyle}>
              {win.type}
            </span>
            {win.estimated_savings != null && win.estimated_savings > 0 && (
              <span className="phosphor-text text-[10px]">
                ~{win.estimated_savings.toLocaleString()} tokens saved
              </span>
            )}
          </div>
          <p className="text-xs leading-relaxed" style={{ color: 'var(--sub-text)' }}>{win.description}</p>
        </div>
        {win.tools.length > 0 && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-[10px] shrink-0 mt-0.5"
            style={{ color: 'var(--sub-text-dim)' }}
          >
            {expanded ? "hide" : `${win.tools.length} tools`}
          </button>
        )}
      </div>
      {expanded && win.tools.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {win.tools.map((t) => (
            <span
              key={t}
              className="text-[10px] font-mono px-1.5 py-0.5 rounded"
              style={{ backgroundColor: 'var(--sub-hull)', color: 'var(--sub-text-dim)' }}
            >
              {t}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
