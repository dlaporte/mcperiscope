interface Props {
  baseline: number;
  optimized: number | null;
  max: number;
}

export function OptimizeContextGauge({ baseline, optimized, max }: Props) {
  if (max <= 0) return null;

  const baselinePct = (baseline / max) * 100;
  const optimizedPct = optimized != null ? (optimized / max) * 100 : null;
  const savings = optimized != null ? baseline - optimized : null;
  const savingsPct = savings != null && baseline > 0 ? (savings / baseline) * 100 : null;

  return (
    <div
      className="flex items-center gap-4 px-4 py-3"
      style={{ backgroundColor: 'var(--sub-panel)', borderBottom: '1px solid var(--sub-rivet)' }}
    >
      <span className="font-stencil text-xs whitespace-nowrap" style={{ color: 'var(--sub-text-dim)' }}>
        Session usage
      </span>

      {/* Gauge bar */}
      <div
        className="flex-1 h-6 rounded-sm overflow-hidden relative"
        style={{
          backgroundColor: "#0e1012",
          border: "1px solid var(--sub-brass-dim)",
          boxShadow: "inset 0 2px 4px rgba(0,0,0,0.7)",
        }}
      >
        {/* Optimized fill (green) — shown when we have an optimized value */}
        {optimizedPct != null && (
          <div
            className="absolute top-0 left-0 h-full rounded-sm"
            style={{
              width: `${Math.max(Math.min(optimizedPct, 100), 1.5)}%`,
              background: "linear-gradient(180deg, #30cc30 0%, #20aa20 100%)",
              boxShadow: "0 0 10px rgba(48,204,48,0.4), 0 0 20px rgba(48,204,48,0.3), inset 0 0 4px rgba(255,255,255,0.1)",
              minWidth: "6px",
              zIndex: 2,
              transition: "width 1.2s cubic-bezier(0.4, 0, 0.2, 1)",
            }}
          />
        )}

        {/* Baseline fill (dim, behind the optimized fill) */}
        <div
          className="absolute top-0 left-0 h-full rounded-sm"
          style={{
            width: `${Math.max(Math.min(baselinePct, 100), 1.5)}%`,
            background: optimizedPct != null
              ? "linear-gradient(180deg, rgba(196,154,42,0.3) 0%, rgba(196,154,42,0.15) 100%)"
              : "linear-gradient(180deg, #c9a030 0%, #a08020 100%)",
            boxShadow: optimizedPct != null
              ? "none"
              : "0 0 10px rgba(201,160,48,0.4), inset 0 0 4px rgba(255,255,255,0.1)",
            minWidth: "6px",
            zIndex: 1,
          }}
        />

        {/* Baseline marker line */}
        {optimizedPct != null && (
          <div
            className="absolute top-0 h-full"
            style={{
              left: `${Math.min(baselinePct, 100)}%`,
              width: "2px",
              backgroundColor: "var(--sub-brass)",
              boxShadow: "0 0 4px rgba(196,154,42,0.6)",
              zIndex: 3,
            }}
            title={`Baseline: ${baseline.toLocaleString()} tokens`}
          />
        )}

        {/* Tick marks */}
        {[25, 50, 75].map((tick) => (
          <div
            key={tick}
            className="absolute top-0 h-full"
            style={{
              left: `${tick}%`,
              width: "1px",
              backgroundColor: "var(--sub-rivet)",
              opacity: 0.5,
            }}
          />
        ))}
      </div>

      {/* Readout */}
      <div className="flex items-center gap-3 shrink-0">
        {optimizedPct != null ? (
          <>
            <span className="text-xs font-mono phosphor-text">
              {optimizedPct.toFixed(1)}%
            </span>
            <span className="text-xs font-mono" style={{ color: 'var(--sub-text-dim)' }}>
              <span style={{ color: 'var(--sub-brass)', textDecoration: 'line-through', opacity: 0.6 }}>
                {baseline.toLocaleString()}
              </span>
              {" → "}
              <span className="phosphor-text">{optimized!.toLocaleString()}</span>
              {" / "}{(max / 1000).toFixed(0)}K
            </span>
            {savingsPct != null && savingsPct > 0 && (
              <span className="text-xs font-mono phosphor-text">
                (-{savingsPct.toFixed(1)}%)
              </span>
            )}
          </>
        ) : (
          <span className="text-xs font-mono" style={{ color: 'var(--sub-text-dim)' }}>
            <span className="phosphor-text">{baselinePct.toFixed(1)}%</span>
            {" "}{baseline.toLocaleString()} / {(max / 1000).toFixed(0)}K
          </span>
        )}
      </div>
    </div>
  );
}
