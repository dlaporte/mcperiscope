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

const IMPACT_COLORS: Record<string, string> = {
  HIGH: "bg-red-500/20 text-red-400 border-red-500/30",
  MEDIUM: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  LOW: "bg-green-500/20 text-green-400 border-green-500/30",
};

const TYPE_COLORS: Record<string, string> = {
  consolidate: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  trim: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  remove: "bg-red-500/20 text-red-400 border-red-500/30",
  rewrite: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
};

function Badge({ label, colorClass }: { label: string; colorClass: string }) {
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded text-xs font-semibold border ${colorClass}`}
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
      className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden cursor-pointer hover:border-gray-600 transition-colors"
      onClick={() => setExpanded(!expanded)}
    >
      <div className="px-4 py-3 flex items-start gap-3">
        <div className="flex gap-2 shrink-0 pt-0.5">
          <Badge
            label={type}
            colorClass={TYPE_COLORS[type] || "bg-gray-500/20 text-gray-400 border-gray-500/30"}
          />
          <Badge
            label={impact}
            colorClass={IMPACT_COLORS[impact] || IMPACT_COLORS.LOW}
          />
        </div>
        <p className="text-gray-200 text-sm flex-1">{rec.description}</p>
        <span className="text-gray-500 text-sm shrink-0">
          {expanded ? "\u25B2" : "\u25BC"}
        </span>
      </div>

      {expanded && (
        <div className="px-4 pb-3 border-t border-gray-700/50 pt-3 space-y-2">
          {rec.affected_tools && rec.affected_tools.length > 0 && (
            <div>
              <span className="text-xs text-gray-500 uppercase tracking-wide">
                Affected Tools
              </span>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {rec.affected_tools.map((tool) => (
                  <span
                    key={tool}
                    className="px-2 py-0.5 bg-gray-700 rounded text-xs text-gray-300 font-mono"
                  >
                    {tool}
                  </span>
                ))}
              </div>
            </div>
          )}
          {rec.evidence && (
            <div>
              <span className="text-xs text-gray-500 uppercase tracking-wide">
                Evidence
              </span>
              <p className="text-sm text-gray-400 mt-0.5">{rec.evidence}</p>
            </div>
          )}
          {rec.estimated_savings != null && (
            <div>
              <span className="text-xs text-gray-500 uppercase tracking-wide">
                Estimated Savings
              </span>
              <p className="text-sm text-green-400 font-semibold mt-0.5">
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
      <h3 className="text-lg font-semibold text-white mb-3">
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
