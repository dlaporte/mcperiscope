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
  HIGH: { backgroundColor: 'rgba(204,51,51,0.2)', color: 'var(--sub-red)', borderColor: 'rgba(204,51,51,0.3)' },
  MEDIUM: { backgroundColor: 'rgba(196,154,42,0.2)', color: 'var(--sub-brass)', borderColor: 'rgba(196,154,42,0.3)' },
  LOW: { backgroundColor: 'rgba(51,255,51,0.2)', color: 'var(--sub-phosphor)', borderColor: 'rgba(51,255,51,0.3)' },
};

const TYPE_STYLES: Record<string, React.CSSProperties> = {
  consolidate: { backgroundColor: 'rgba(196,154,42,0.15)', color: 'var(--sub-brass-glow)', borderColor: 'rgba(196,154,42,0.3)' },
  trim: { backgroundColor: 'rgba(196,154,42,0.2)', color: 'var(--sub-brass)', borderColor: 'rgba(196,154,42,0.3)' },
  remove: { backgroundColor: 'rgba(204,51,51,0.2)', color: 'var(--sub-red)', borderColor: 'rgba(204,51,51,0.3)' },
  rewrite: { backgroundColor: 'rgba(51,255,51,0.15)', color: 'var(--sub-phosphor)', borderColor: 'rgba(51,255,51,0.3)' },
};

const defaultBadgeStyle: React.CSSProperties = { backgroundColor: 'var(--sub-panel-light)', color: 'var(--sub-text-dim)', borderColor: 'var(--sub-rivet)' };

function Badge({ label, style }: { label: string; style: React.CSSProperties }) {
  return (
    <span
      className="inline-block px-2 py-0.5 rounded text-xs font-semibold border"
      style={style}
    >
      {label}
    </span>
  );
}

function RecommendationCard({ rec }: { rec: Recommendation }) {
  const [expanded, setExpanded] = useState(false);
  const impact = (rec.impact || "LOW").toUpperCase();
  const type = (rec.type || "").toLowerCase();

  return (
    <div
      className="panel-riveted rounded-lg overflow-hidden cursor-pointer transition-colors"
      onClick={() => setExpanded(!expanded)}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--sub-brass-dim)')}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--sub-rivet)')}
    >
      <div className="px-4 py-3 flex items-start gap-3">
        <div className="flex gap-2 shrink-0 pt-0.5">
          <Badge
            label={type}
            style={TYPE_STYLES[type] || defaultBadgeStyle}
          />
          <Badge
            label={impact}
            style={IMPACT_STYLES[impact] || IMPACT_STYLES.LOW}
          />
        </div>
        <p className="text-sm flex-1" style={{ color: 'var(--sub-text)' }}>{rec.description}</p>
        <span className="text-sm shrink-0" style={{ color: 'var(--sub-text-dim)' }}>
          {expanded ? "\u25B2" : "\u25BC"}
        </span>
      </div>

      {expanded && (
        <div className="px-4 pb-3 pt-3 space-y-2" style={{ borderTop: '1px solid rgba(74,78,80,0.5)' }}>
          {rec.affected_tools && rec.affected_tools.length > 0 && (
            <div>
              <span className="text-xs uppercase tracking-wide" style={{ color: 'var(--sub-text-dim)' }}>
                Affected Tools
              </span>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {rec.affected_tools.map((tool) => (
                  <span
                    key={tool}
                    className="px-2 py-0.5 rounded text-xs font-mono"
                    style={{ backgroundColor: 'var(--sub-hull)', color: 'var(--sub-text)' }}
                  >
                    {tool}
                  </span>
                ))}
              </div>
            </div>
          )}
          {rec.evidence && (
            <div>
              <span className="text-xs uppercase tracking-wide" style={{ color: 'var(--sub-text-dim)' }}>
                Evidence
              </span>
              <p className="text-sm mt-0.5" style={{ color: 'var(--sub-text-dim)' }}>{rec.evidence}</p>
            </div>
          )}
          {rec.estimated_savings != null && (
            <div>
              <span className="text-xs uppercase tracking-wide" style={{ color: 'var(--sub-text-dim)' }}>
                Estimated Savings
              </span>
              <p className="text-sm font-semibold mt-0.5 phosphor-text">
                {typeof rec.estimated_savings === "number"
                  ? `${rec.estimated_savings.toLocaleString()} tokens`
                  : rec.estimated_savings}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function RecommendationCards({ recommendations }: Props) {
  const sorted = [...recommendations].sort(
    (a, b) =>
      (IMPACT_ORDER[(a.impact || "LOW").toUpperCase()] ?? 3) -
      (IMPACT_ORDER[(b.impact || "LOW").toUpperCase()] ?? 3),
  );

  if (sorted.length === 0) {
    return null;
  }

  return (
    <div>
      <h3 className="text-lg font-semibold font-stencil mb-3" style={{ color: 'var(--sub-text)' }}>
        Recommendations ({sorted.length})
      </h3>
      <div className="space-y-2">
        {sorted.map((rec, i) => (
          <RecommendationCard key={i} rec={rec} />
        ))}
      </div>
    </div>
  );
}
