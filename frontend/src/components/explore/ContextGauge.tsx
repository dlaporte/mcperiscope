interface Props {
  tokens: number;
  max: number;
  onClick?: () => void;
}

export function ContextGauge({ tokens, max, onClick }: Props) {
  if (max <= 0) return null;

  const pct = (tokens / max) * 100;
  const fillColor =
    pct > 75 ? "#dd4040" : pct > 50 ? "#c9a030" : "#30cc30";
  const glowColor =
    pct > 75 ? "rgba(221,64,64,0.5)" : pct > 50 ? "rgba(201,160,48,0.4)" : "rgba(48,204,48,0.4)";

  return (
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
        {/* Fill */}
        <div
          className="h-full rounded-sm transition-all duration-500"
          style={{
            width: `${Math.max(Math.min(pct, 100), 1.5)}%`,
            background: `linear-gradient(180deg, ${fillColor} 0%, ${fillColor} 100%)`,
            boxShadow: `0 0 10px ${glowColor}, 0 0 20px ${glowColor}, inset 0 0 4px rgba(255,255,255,0.1)`,
            minWidth: "6px",
          }}
        />

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
