import { useState, useMemo } from "react";
import { useStore } from "../../store";

const IMPACT_STYLES: Record<string, React.CSSProperties> = {
  HIGH: { backgroundColor: 'rgba(204,51,51,0.2)', color: 'var(--sub-red)' },
  MEDIUM: { backgroundColor: 'rgba(196,154,42,0.2)', color: 'var(--sub-brass)' },
  LOW: { backgroundColor: 'rgba(51,255,51,0.2)', color: 'var(--sub-phosphor)' },
};

const TYPE_STYLES: Record<string, React.CSSProperties> = {
  // Inventory recommendations
  trim_descriptions: { backgroundColor: 'rgba(196,154,42,0.2)', color: 'var(--sub-brass)' },
  remove_unused: { backgroundColor: 'rgba(204,51,51,0.2)', color: 'var(--sub-red)' },
  consolidate_lookups: { backgroundColor: 'rgba(196,154,42,0.15)', color: 'var(--sub-brass-glow)' },
  resource_context_usage: { backgroundColor: 'rgba(100,149,237,0.2)', color: '#6495ed' },
  // Behavior recommendations (from run_analysis)
  consolidate: { backgroundColor: 'rgba(196,154,42,0.15)', color: 'var(--sub-brass-glow)' },
  rewrite_description: { backgroundColor: 'rgba(196,154,42,0.2)', color: 'var(--sub-brass)' },
  trim_response: { backgroundColor: 'rgba(196,154,42,0.2)', color: 'var(--sub-brass)' },
  batch: { backgroundColor: 'rgba(51,255,51,0.15)', color: 'var(--sub-phosphor)' },
  add_defaults: { backgroundColor: 'rgba(51,255,51,0.15)', color: 'var(--sub-phosphor)' },
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
      className="py-1.5 px-1 rounded transition-colors cursor-pointer"
      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--sub-panel-light)')}
      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
      onClick={onToggle}
    >
      <div className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          onClick={(e) => e.stopPropagation()}
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
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
          >
            {expanded ? description : truncate(description, 100)}
          </p>
        </div>
      </div>
    </div>
  );
}

function isRecFullyDisabled(
  rec: any,
  disabledTools: Set<string>,
  disabledResources: Set<string>,
): boolean {
  const affectedTools: string[] = rec.source_tools || rec.tools || [];
  const affectedResources: string[] = rec.affected_resources || [];
  if (affectedTools.length === 0 && affectedResources.length === 0) return false;
  const allToolsDisabled = affectedTools.length > 0 && affectedTools.every((t: string) => disabledTools.has(t));
  const allResourcesDisabled = affectedResources.length > 0 && affectedResources.every((r: string) => disabledResources.has(r));
  if (affectedTools.length > 0 && affectedResources.length > 0) {
    return allToolsDisabled && allResourcesDisabled;
  }
  return allToolsDisabled || allResourcesDisabled;
}

export function RecommendationsPanel() {
  const recommendations = useStore((s) => s.recommendations);
  const quickWins = useStore((s) => s.quickWins);
  const enabledRecIds = useStore((s) => s.enabledRecIds);
  const toggleRecEnabled = useStore((s) => s.toggleRecEnabled);
  const setAllRecsEnabled = useStore((s) => s.setAllRecsEnabled);
  const disabledTools = useStore((s) => s.disabledTools);
  const disabledResources = useStore((s) => s.disabledResources);

  const hasAny = recommendations.length > 0 || quickWins.length > 0;
  const enabledCount = enabledRecIds.size;

  // Determine which recommendations are fully disabled by inventory
  const fullyDisabledRecIds = useMemo(() => {
    const ids = new Set<string>();
    for (const rec of [...recommendations, ...quickWins]) {
      if (rec.id && isRecFullyDisabled(rec, disabledTools, disabledResources)) {
        ids.add(rec.id);
      }
    }
    return ids;
  }, [recommendations, quickWins, disabledTools, disabledResources]);

  return (
    <div>
      {/* Header */}
      <div className="px-3 py-2 flex items-center justify-between" style={{ borderBottom: '1px solid var(--sub-rivet)' }}>
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
              <div key={rec.id} style={fullyDisabledRecIds.has(rec.id) ? { opacity: 0.4 } : undefined}>
                <RecItem
                  id={rec.id}
                  type={rec.type}
                  description={rec.description}
                  impact={rec.impact}
                  checked={enabledRecIds.has(rec.id)}
                  onToggle={() => toggleRecEnabled(rec.id)}
                />
              </div>
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
              <div key={win.id} style={fullyDisabledRecIds.has(win.id) ? { opacity: 0.4 } : undefined}>
                <RecItem
                  id={win.id}
                  type={win.type}
                  description={win.description}
                  checked={enabledRecIds.has(win.id)}
                  onToggle={() => toggleRecEnabled(win.id)}
                />
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}
