import { useState } from "react";
import { useStore } from "../../store";

const IMPACT_STYLES: Record<string, React.CSSProperties> = {
  HIGH: { backgroundColor: 'rgba(204,51,51,0.2)', color: 'var(--sub-red)' },
  MEDIUM: { backgroundColor: 'rgba(196,154,42,0.2)', color: 'var(--sub-brass)' },
  LOW: { backgroundColor: 'rgba(51,255,51,0.2)', color: 'var(--sub-phosphor)' },
};

const TYPE_STYLES: Record<string, React.CSSProperties> = {
  consolidate: { backgroundColor: 'rgba(196,154,42,0.15)', color: 'var(--sub-brass-glow)' },
  trim: { backgroundColor: 'rgba(196,154,42,0.2)', color: 'var(--sub-brass)' },
  remove: { backgroundColor: 'rgba(204,51,51,0.2)', color: 'var(--sub-red)' },
  rewrite: { backgroundColor: 'rgba(51,255,51,0.15)', color: 'var(--sub-phosphor)' },
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

const defaultBadgeStyle: React.CSSProperties = { backgroundColor: 'var(--sub-panel-light)', color: 'var(--sub-text-dim)' };

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + "...";
}

interface RecItemProps {
  id: string;
  type: string;
  description: string;
  impact?: string;
  checked: boolean;
  onToggle: () => void;
}

function RecItem({ id, type, description, impact, checked, onToggle }: RecItemProps) {
  const [expanded, setExpanded] = useState(false);
  const typeLower = (type || "").toLowerCase();
  const badgeStyle = TYPE_STYLES[typeLower] || defaultBadgeStyle;

  return (
    <div
      className="py-1.5 px-1 rounded transition-colors"
      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--sub-panel-light)')}
      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
    >
      <label className="flex items-start gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          className="w-3 h-3 mt-0.5 rounded cursor-pointer accent-amber-600 shrink-0"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded" style={badgeStyle}>
              {typeLower}
            </span>
            {impact && (
              <span
                className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                style={IMPACT_STYLES[(impact || "LOW").toUpperCase()] || IMPACT_STYLES.LOW}
              >
                {impact.toUpperCase()}
              </span>
            )}
          </div>
          <p
            className="text-[11px] mt-0.5 leading-snug cursor-pointer"
            style={{ color: 'var(--sub-text)' }}
            onClick={(e) => {
              e.preventDefault();
              setExpanded(!expanded);
            }}
          >
            {expanded ? description : truncate(description, 100)}
          </p>
        </div>
      </label>
    </div>
  );
}

export function RecommendationsPanel() {
  const recommendations = useStore((s) => s.recommendations);
  const quickWins = useStore((s) => s.quickWins);
  const enabledRecIds = useStore((s) => s.enabledRecIds);
  const toggleRecEnabled = useStore((s) => s.toggleRecEnabled);
  const setAllRecsEnabled = useStore((s) => s.setAllRecsEnabled);
  const optimizeRunning = useStore((s) => s.optimizeRunning);
  const optimizeProgress = useStore((s) => s.optimizeProgress);
  const runOptimizeWithSelection = useStore((s) => s.runOptimizeWithSelection);

  const hasAny = recommendations.length > 0 || quickWins.length > 0;
  const enabledCount = enabledRecIds.size;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-3 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid var(--sub-rivet)' }}>
        <h3 className="text-sm font-semibold font-stencil" style={{ color: 'var(--sub-text)' }}>
          Recommendations
        </h3>
        {hasAny && (
          <div className="flex items-center gap-2 text-[10px]">
            <button
              onClick={() => setAllRecsEnabled(true)}
              style={{ color: 'var(--sub-brass)' }}
              className="hover:underline"
            >
              Select All
            </button>
            <span style={{ color: 'var(--sub-text-dim)' }}>/</span>
            <button
              onClick={() => setAllRecsEnabled(false)}
              style={{ color: 'var(--sub-brass)' }}
              className="hover:underline"
            >
              Deselect All
            </button>
          </div>
        )}
      </div>

      {/* Scrollable list */}
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {!hasAny && (
          <p className="text-xs p-2" style={{ color: 'var(--sub-text-dim)' }}>
            No recommendations yet. Run evaluations on the Evaluate tab first.
          </p>
        )}

        {recommendations.length > 0 && (
          <div className="mb-3">
            <div className="px-1 py-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--sub-text-dim)' }}>
                Behavior
              </span>
            </div>
            {recommendations.map((rec: any) => (
              <RecItem
                key={rec.id}
                id={rec.id}
                type={rec.type}
                description={rec.description}
                impact={rec.impact}
                checked={enabledRecIds.has(rec.id)}
                onToggle={() => toggleRecEnabled(rec.id)}
              />
            ))}
          </div>
        )}

        {quickWins.length > 0 && (
          <div>
            <div className="px-1 py-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--sub-text-dim)' }}>
                Inventory
              </span>
            </div>
            {quickWins.map((win: any) => (
              <RecItem
                key={win.id}
                id={win.id}
                type={win.type}
                description={win.description}
                checked={enabledRecIds.has(win.id)}
                onToggle={() => toggleRecEnabled(win.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Optimize button */}
      <div className="px-3 py-3" style={{ borderTop: '1px solid var(--sub-rivet)' }}>
        <button
          onClick={runOptimizeWithSelection}
          disabled={!hasAny || enabledCount === 0 || optimizeRunning}
          className="w-full py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          style={{
            backgroundColor: optimizeRunning ? 'var(--sub-panel-light)' : 'var(--sub-brass)',
            color: optimizeRunning ? 'var(--sub-text)' : 'var(--sub-hull)',
          }}
        >
          {optimizeRunning ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              {optimizeProgress || "Optimizing..."}
            </span>
          ) : (
            `Optimize (${enabledCount} selected)`
          )}
        </button>
      </div>
    </div>
  );
}
