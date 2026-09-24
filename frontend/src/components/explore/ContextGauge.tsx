// Fill and glow colors by percentage of the context window used
export function gaugeFillColors(pct: number) {
  if (pct > 75) return { fill: "#dd4040", glow: "rgba(221,64,64,0.5)" };
  if (pct > 50) return { fill: "#c9a030", glow: "rgba(201,160,48,0.4)" };
  return { fill: "#30cc30", glow: "rgba(48,204,48,0.4)" };
}

export const GAUGE_TRACK_STYLE: React.CSSProperties = {
  backgroundColor: "#0e1012",
  border: "1px solid var(--sub-brass-dim)",
  boxShadow: "inset 0 2px 4px rgba(0,0,0,0.7)",
};

interface Props {
  tokens: number;
  max: number;
  onClick?: () => void;
}

export function ContextGauge({ tokens, max, onClick }: Props) {
  if (max <= 0) return null;

  const pct = (tokens / max) * 100;
  const { fill: fillColor, glow: glowColor } = gaugeFillColors(pct);

  return (
    <div className="flex items-center gap-4 flex-1 min-w-0">
      {/* Gauge bar */}
      <div
        className="flex-1 h-6 rounded-sm overflow-hidden relative"
        style={GAUGE_TRACK_STYLE}
      >
        {/* Fill */}
        <div
          className="h-full rounded-sm transition-all duration-500"
          style={{
            width: `${Math.max(Math.min(pct, 100), 1.5)}%`,
            background: fillColor,
            boxShadow: `0 0 10px ${glowColor}, 0 0 20px ${glowColor}, inset 0 0 4px rgba(255,255,255,0.1)`,
            minWidth: "6px",
          }}
        />

      </div>

      {/* Readout */}
      <div className="flex items-center gap-3 shrink-0">
        <span className="text-xs font-mono whitespace-nowrap phosphor-text">
          {pct.toFixed(1)}%
        </span>
        {onClick ? (
          <button
            onClick={onClick}
            className="text-xs font-mono whitespace-nowrap cursor-pointer hover:underline"
            style={{ color: "var(--sub-text-dim)" }}
            title="View context window contents"
          >
            {tokens.toLocaleString()} / {(max / 1000).toFixed(0)}K
          </button>
        ) : (
          <span className="text-xs font-mono whitespace-nowrap" style={{ color: "var(--sub-text-dim)" }}>
            {tokens.toLocaleString()} / {(max / 1000).toFixed(0)}K
          </span>
        )}
      </div>
    </div>
  );
}
