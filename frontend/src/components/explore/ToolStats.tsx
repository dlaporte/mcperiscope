import { useState, useEffect } from "react";
import { api } from "../../api/client";

interface ToolAnalysis {
  name: string;
  descriptionTokens?: number;
  schemaTokens?: number;
  totalTokens?: number;
  contextPct?: number;
  model?: string;
  contextWindow?: number;
  similarTools?: Array<{ name: string; distance: number }>;
  cluster?: { prefix: string; count: number };
}

interface Props {
  toolName: string;
}

export function ToolStats({ toolName }: Props) {
  // Last fetch result, tagged with the tool it was for (loading until it matches)
  const [fetched, setFetched] = useState<{ toolName: string; stats: ToolAnalysis | null; error: string | null } | null>(null);
  const loading = fetched?.toolName !== toolName;
  const stats = loading ? null : fetched?.stats ?? null;
  const error = loading ? null : fetched?.error ?? null;

  useEffect(() => {
    let cancelled = false;
    api.getToolAnalysis(toolName)
      .then((data: ToolAnalysis) => {
        if (!cancelled) setFetched({ toolName, stats: data, error: null });
      })
      .catch((err) => {
        if (!cancelled) setFetched({ toolName, stats: null, error: err.message });
      });

    return () => {
      cancelled = true;
    };
  }, [toolName]);

  if (loading) {
    return (
      <div className="text-xs animate-pulse" style={{ color: 'var(--sub-text-dim)' }}>
        Loading tool stats...
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-xs" style={{ color: 'var(--sub-text-dim)' }}>
        Stats unavailable
      </div>
    );
  }

  if (!stats) return null;

  return (
    <div
      className="rounded-lg p-3 space-y-2 text-xs panel-riveted"
    >
      {/* Token budget */}
      {stats.totalTokens != null && (
        <div className="flex items-center gap-2">
          <span style={{ color: 'var(--sub-text-dim)' }}>Token budget:</span>
          <span className="font-mono" style={{ color: 'var(--sub-text)' }}>
            {stats.totalTokens} tokens
            {stats.descriptionTokens != null && stats.schemaTokens != null && (
              <span style={{ color: 'var(--sub-text-dim)' }}>
                {" "}(desc: {stats.descriptionTokens}, schema: {stats.schemaTokens})
              </span>
            )}
          </span>
        </div>
      )}

      {/* Context window impact */}
      {stats.contextPct != null && stats.model && stats.contextWindow && (
        <div className="flex items-center gap-2">
          <span style={{ color: 'var(--sub-text-dim)' }}>Context impact:</span>
          <span className="font-mono" style={{ color: 'var(--sub-text)' }}>
            {stats.contextPct.toFixed(2)}% of {stats.model}'s {(stats.contextWindow / 1000).toFixed(0)}K context
          </span>
        </div>
      )}

      {/* Similar tools */}
      {stats.similarTools && stats.similarTools.length > 0 && (
        <div>
          <span style={{ color: 'var(--sub-text-dim)' }}>Similar tools:</span>
          <div className="flex flex-wrap gap-1 mt-1">
            {stats.similarTools.map((t) => (
              <span
                key={t.name}
                className="inline-block px-1.5 py-0.5 rounded font-mono"
                style={{ backgroundColor: 'var(--sub-hull)', color: 'var(--sub-text-dim)' }}
                title={`Edit distance: ${t.distance}`}
              >
                {t.name}
                <span className="ml-1" style={{ color: 'var(--sub-text-dim)', opacity: 0.6 }}>d={t.distance}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Cluster */}
      {stats.cluster && (
        <div className="flex items-center gap-2">
          <span style={{ color: 'var(--sub-text-dim)' }}>Cluster:</span>
          <span className="font-mono" style={{ color: 'var(--sub-text)' }}>
            {stats.cluster.prefix}*
            <span className="ml-1" style={{ color: 'var(--sub-text-dim)' }}>({stats.cluster.count} tools)</span>
          </span>
        </div>
      )}
    </div>
  );
}
