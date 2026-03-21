interface Props {
  tokens: number;
  max: number;
}

export function ContextGauge({ tokens, max }: Props) {
  const pct = max > 0 ? (tokens / max) * 100 : 0;
  const arcColor = pct > 15 ? '#cc3333' : pct > 5 ? '#c49a2a' : '#33ff33';

  // SVG arc from -225deg to +45deg (270deg sweep)
  // At 0% the needle is at -225deg (7:30 position), at 100% it's at +45deg (1:30 position)
  const radius = 40;
  const cx = 50;
  const cy = 50;
  const startAngle = -225;
  const endAngle = 45;
  const totalSweep = endAngle - startAngle; // 270 degrees
  const fillAngle = startAngle + (totalSweep * Math.min(pct, 100) / 100);

  const polarToCartesian = (angle: number) => {
    const rad = (angle * Math.PI) / 180;
    return {
      x: cx + radius * Math.cos(rad),
      y: cy + radius * Math.sin(rad),
    };
  };

  const start = polarToCartesian(startAngle);
  const end = polarToCartesian(fillAngle);
  const largeArc = (fillAngle - startAngle) > 180 ? 1 : 0;

  const arcPath = `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} 1 ${end.x} ${end.y}`;

  // Background arc (full sweep, dim)
  const bgEnd = polarToCartesian(endAngle);
  const bgLargeArc = (endAngle - startAngle) > 180 ? 1 : 0;
  const bgArcPath = `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${bgLargeArc} 1 ${bgEnd.x} ${bgEnd.y}`;

  return (
    <div className="flex items-center gap-3">
      <svg width="70" height="70" viewBox="0 0 100 100">
        {/* Bezel ring */}
        <circle cx={cx} cy={cy} r="47" fill="none" stroke="#8b6f1e" strokeWidth="3" opacity="0.6" />
        <circle cx={cx} cy={cy} r="44" fill="#1a1d1e" stroke="#4a4e50" strokeWidth="1" />

        {/* Background arc */}
        <path d={bgArcPath} fill="none" stroke="#2a2d2e" strokeWidth="6" strokeLinecap="round" />

        {/* Fill arc */}
        {pct > 0 && (
          <path d={arcPath} fill="none" stroke={arcColor} strokeWidth="6" strokeLinecap="round"
            style={{ filter: `drop-shadow(0 0 3px ${arcColor}40)` }}
          />
        )}

        {/* Center text */}
        <text x={cx} y={cy - 4} textAnchor="middle" fontSize="11" fontFamily="monospace" fontWeight="bold"
          fill={arcColor} style={{ textShadow: `0 0 4px ${arcColor}40` }}>
          {pct.toFixed(1)}%
        </text>
        <text x={cx} y={cy + 10} textAnchor="middle" fontSize="7" fontFamily="'Black Ops One', sans-serif"
          fill="#7a7a72" letterSpacing="0.1em">
          CONTEXT
        </text>

        {/* Tick marks */}
        {[0, 25, 50, 75, 100].map((tick) => {
          const tickAngle = startAngle + (totalSweep * tick / 100);
          const innerR = radius - 8;
          const outerR = radius - 3;
          const inner = {
            x: cx + innerR * Math.cos((tickAngle * Math.PI) / 180),
            y: cy + innerR * Math.sin((tickAngle * Math.PI) / 180),
          };
          const outer = {
            x: cx + outerR * Math.cos((tickAngle * Math.PI) / 180),
            y: cy + outerR * Math.sin((tickAngle * Math.PI) / 180),
          };
          return (
            <line key={tick} x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y}
              stroke="#7a7a72" strokeWidth="1" />
          );
        })}
      </svg>

      <div className="text-xs" style={{ color: 'var(--sub-text-dim)' }}>
        <span className="font-mono phosphor-text">{tokens.toLocaleString()}</span>
        <span> / {max.toLocaleString()}</span>
      </div>
    </div>
  );
}
