interface Props {
  baseline: number;
  optimized: number | null;
  max: number;
}

function fillColors(pct: number) {
  if (pct > 75) return { fill: "#dd4040", glow: "rgba(221,64,64,0.5)" };
  if (pct > 50) return { fill: "#c9a030", glow: "rgba(201,160,48,0.4)" };
  return { fill: "#30cc30", glow: "rgba(48,204,48,0.4)" };
}

export function OptimizeContextGauge({ baseline, optimized, max }: Props) {
  if (max <= 0) return null;

  const baselinePct = (baseline / max) * 100;
  const optimizedPct = optimized != null ? (optimized / max) * 100 : null;
  const savings = optimized != null ? baseline - optimized : null;
  const savingsPct = savings != null && baseline > 0 ? (savings / baseline) * 100 : null;

  const baselineColors = fillColors(baselinePct);
  const optimizedColors = optimizedPct != null ? fillColors(optimizedPct) : null;

  return (
    <div
      className="flex items-center gap-4 px-4 py-3"
      style={{ backgroundColor: 'var(--sub-panel)', borderBottom: '1px solid var(--sub-rivet)' }}
    >
      <span className="font-stencil text-xs whitespace-nowrap" style={{ color: 'var(--sub-text-dim)' }}>
        Session usage
      </span>

      <div className="flex items-center gap-4 flex-1 min-w-0">
      {/* Gauge bar */}
      <div
        className="flex-1 h-6 rounded-sm overflow-hidden relative"
        style={{
          backgroundColor: "#0e1012",
          border: "1px solid var(--sub-brass-dim)",
          boxShadow: "inset 0 2px 4px rgba(0,0,0,0.7)",
        }}
      >
        {/* Optimized fill — shown when we have an optimized value */}
        {optimizedPct != null && optimizedColors && (
          <div
            className="absolute top-0 left-0 h-full rounded-sm"
            style={{
              width: `${Math.max(Math.min(optimizedPct, 100), 1.5)}%`,
              background: `linear-gradient(180deg, ${optimizedColors.fill} 0%, ${optimizedColors.fill} 100%)`,
              boxShadow: `0 0 10px ${optimizedColors.glow}, 0 0 20px ${optimizedColors.glow}, inset 0 0 4px rgba(255,255,255,0.1)`,
              minWidth: "6px",
              zIndex: 2,
              transition: "width 1.2s cubic-bezier(0.4, 0, 0.2, 1)",
            }}
          />
        )}

        {/* Baseline fill */}
        <div
          className="absolute top-0 left-0 h-full rounded-sm"
          style={{
            width: `${Math.max(Math.min(baselinePct, 100), 1.5)}%`,
            background: optimizedPct != null
              ? `linear-gradient(180deg, ${baselineColors.fill}40 0%, ${baselineColors.fill}20 100%)`
              : `linear-gradient(180deg, ${baselineColors.fill} 0%, ${baselineColors.fill} 100%)`,
            boxShadow: optimizedPct != null
              ? "none"
              : `0 0 10px ${baselineColors.glow}, inset 0 0 4px rgba(255,255,255,0.1)`,
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
              backgroundColor: baselineColors.fill,
              boxShadow: `0 0 4px ${baselineColors.glow}`,
              zIndex: 3,
            }}
            title={`Baseline: ${baseline.toLocaleString()} tokens`}
          />
        )}

      </div>

      {/* Readout */}
      <div className="flex items-center gap-3 shrink-0">
        {optimizedPct != null ? (
          <>
            <span className="text-xs font-mono phosphor-text">
              {optimizedPct.toFixed(1)}%
            </span>
            <span className="text-xs font-mono" style={{ color: 'var(--sub-text-dim)' }}>
              <span style={{ color: baselineColors.fill, textDecoration: 'line-through', opacity: 0.6 }}>
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
          <>
            <span className="text-xs font-mono whitespace-nowrap phosphor-text">
              {baselinePct.toFixed(1)}%
            </span>
            <span className="text-xs font-mono whitespace-nowrap" style={{ color: 'var(--sub-text-dim)' }}>
              {baseline.toLocaleString()} / {(max / 1000).toFixed(0)}K
            </span>
          </>
        )}
      </div>
      </div>
    </div>
  );
}
