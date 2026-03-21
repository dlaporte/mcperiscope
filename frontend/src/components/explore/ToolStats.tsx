import { useState, useEffect } from "react";

interface ToolAnalysis {
  name: string;
  description_tokens?: number;
  schema_tokens?: number;
  total_tokens?: number;
  context_pct?: number;
  model?: string;
  context_window?: number;
  similar_tools?: Array<{ name: string; distance: number }>;
  cluster?: { prefix: string; count: number };
}

interface Props {
  toolName: string;
}

export function ToolStats({ toolName }: Props) {
  const [stats, setStats] = useState<ToolAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setStats(null);

    fetch(`/api/analysis/tool/${encodeURIComponent(toolName)}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || body.detail || `HTTP ${res.status}`);
        }
        return res.json();
      })
      .then((data) => {
        if (!cancelled) setStats(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
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
      {stats.total_tokens != null && (
        <div className="flex items-center gap-2">
          <span style={{ color: 'var(--sub-text-dim)' }}>Token budget:</span>
          <span className="font-mono" style={{ color: 'var(--sub-text)' }}>
            {stats.total_tokens} tokens
            {stats.description_tokens != null && stats.schema_tokens != null && (
              <span style={{ color: 'var(--sub-text-dim)' }}>
                {" "}(desc: {stats.description_tokens}, schema: {stats.schema_tokens})
              </span>
            )}
          </span>
        </div>
      )}

      {/* Context window impact */}
      {stats.context_pct != null && stats.model && stats.context_window && (
        <div className="flex items-center gap-2">
          <span style={{ color: 'var(--sub-text-dim)' }}>Context impact:</span>
          <span className="font-mono" style={{ color: 'var(--sub-text)' }}>
            {stats.context_pct.toFixed(2)}% of {stats.model}'s {(stats.context_window / 1000).toFixed(0)}K context
          </span>
        </div>
      )}

      {/* Similar tools */}
      {stats.similar_tools && stats.similar_tools.length > 0 && (
        <div>
          <span style={{ color: 'var(--sub-text-dim)' }}>Similar tools:</span>
          <div className="flex flex-wrap gap-1 mt-1">
            {stats.similar_tools.map((t) => (
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
