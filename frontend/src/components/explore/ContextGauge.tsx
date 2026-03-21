interface Props {
  tokens: number;
  max: number;
}

export function ContextGauge({ tokens, max }: Props) {
  if (max <= 0) return null;

  const pct = (tokens / max) * 100;
  const fillColor =
    pct > 15 ? "var(--sub-red)" : pct > 5 ? "var(--sub-brass)" : "var(--sub-phosphor)";
  const glowColor =
    pct > 15 ? "rgba(204,51,51,0.4)" : pct > 5 ? "rgba(196,154,42,0.3)" : "rgba(51,255,51,0.3)";

  return (
    <div className="flex items-center gap-3 flex-1 min-w-0">
      {/* Gauge bar */}
      <div
        className="flex-1 h-4 rounded-sm overflow-hidden relative"
        style={{
          backgroundColor: "#1a1d1e",
          border: "1px solid var(--sub-brass-dim)",
          boxShadow: "inset 0 1px 3px rgba(0,0,0,0.5)",
        }}
      >
        {/* Fill */}
        <div
          className="h-full rounded-sm transition-all duration-500"
          style={{
            width: `${Math.max(Math.min(pct, 100), 1.5)}%`,
            background: `linear-gradient(180deg, ${fillColor} 0%, ${fillColor} 60%, ${fillColor}99 100%)`,
            boxShadow: `0 0 12px ${glowColor}, inset 0 0 6px ${glowColor}`,
            minWidth: "4px",
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
      <span className="text-xs font-mono whitespace-nowrap phosphor-text">
        {pct.toFixed(1)}%
      </span>
      <span className="text-xs whitespace-nowrap" style={{ color: "var(--sub-text-dim)" }}>
        {tokens.toLocaleString()} / {(max / 1000).toFixed(0)}K
      </span>
    </div>
  );
}
