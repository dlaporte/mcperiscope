import { useState } from "react";

interface Recommendation {
  type: string;
  impact: string;
  description: string;
  affected_tools?: string[];
  evidence?: string;
  estimated_savings?: string | number;
  [key: string]: unknown;
}

interface Props {
  recommendations: Recommendation[];
}

const IMPACT_ORDER: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

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
};

const defaultBadgeStyle: React.CSSProperties = { backgroundColor: 'var(--sub-panel-light)', color: 'var(--sub-text-dim)' };

function RecommendationCard({ rec, expanded, onToggle }: { rec: Recommendation; expanded: boolean; onToggle: () => void }) {
  const impact = (rec.impact || "LOW").toUpperCase();
  const type = (rec.type || "").toLowerCase();
  const hasDetails = (rec.affected_tools && rec.affected_tools.length > 0) || rec.evidence || rec.estimated_savings != null;

  return (
    <div className="panel-riveted rounded-lg p-3">
      <div
        className={hasDetails ? "cursor-pointer" : ""}
        onClick={hasDetails ? onToggle : undefined}
      >
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded" style={TYPE_STYLES[type] || defaultBadgeStyle}>
            {type}
          </span>
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded" style={IMPACT_STYLES[impact] || IMPACT_STYLES.LOW}>
            {impact}
          </span>
          {rec.estimated_savings != null && (
            <span className="phosphor-text text-[10px]">
              ~{typeof rec.estimated_savings === "number" ? rec.estimated_savings.toLocaleString() : rec.estimated_savings} tokens saved
            </span>
          )}
          {hasDetails && (
            <span className="text-[10px] ml-auto" style={{ color: 'var(--sub-text-dim)' }}>
              {expanded ? "\u25BE" : "\u25B8"}
            </span>
          )}
        </div>
        <p className="text-xs leading-relaxed" style={{ color: 'var(--sub-text)' }}>{rec.description}</p>
      </div>
      {expanded && hasDetails && (
        <div className="mt-2 space-y-2 text-xs">
          {rec.affected_tools && rec.affected_tools.length > 0 && (
            <div>
              <span className="uppercase tracking-wide" style={{ color: 'var(--sub-text-dim)' }}>Affected Tools</span>
              <div className="flex flex-wrap gap-1 mt-1">
                {rec.affected_tools.map((tool) => (
                  <span key={tool} className="px-1.5 py-0.5 rounded font-mono text-[10px]" style={{ backgroundColor: 'var(--sub-hull)', color: 'var(--sub-text-dim)' }}>
                    {tool}
                  </span>
                ))}
              </div>
            </div>
          )}
          {rec.evidence && (
            <div>
              <span className="uppercase tracking-wide" style={{ color: 'var(--sub-text-dim)' }}>Evidence</span>
              <p className="mt-0.5" style={{ color: 'var(--sub-text-dim)' }}>{rec.evidence}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function RecommendationCards({ recommendations }: Props) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  const sorted = [...recommendations].sort(
    (a, b) =>
      (IMPACT_ORDER[(a.impact || "LOW").toUpperCase()] ?? 3) -
      (IMPACT_ORDER[(b.impact || "LOW").toUpperCase()] ?? 3),
  );

  if (sorted.length === 0) return null;

  return (
    <div className="panel-riveted rounded-lg overflow-hidden">
      <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--sub-rivet)' }}>
        <h3 className="text-lg font-semibold font-stencil" style={{ color: 'var(--sub-text)' }}>
          Recommendations ({sorted.length})
        </h3>
      </div>
      <div className="p-4 space-y-2">
        {sorted.map((rec, i) => (
          <RecommendationCard
            key={i}
            rec={rec}
            expanded={expandedIndex === i}
            onToggle={() => setExpandedIndex(expandedIndex === i ? null : i)}
          />
        ))}
      </div>
    </div>
  );
}
