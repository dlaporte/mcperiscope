interface Props {
  tokens: number;
  max: number;
}

export function ContextBudget({ tokens, max }: Props) {
  if (max <= 0) return null;

  const pct = (tokens / max) * 100;
  const fillColor =
    pct > 15 ? "var(--sub-red)" : pct > 5 ? "var(--sub-brass)" : "var(--sub-phosphor)";

  return (
    <div className="flex items-center gap-2 min-w-0">
      <div
        className="flex-1 h-2.5 rounded-full overflow-hidden min-w-[80px]"
        style={{ backgroundColor: 'var(--sub-panel-light)' }}
      >
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: fillColor }}
        />
      </div>
      <span className="text-xs whitespace-nowrap" style={{ color: 'var(--sub-text-dim)' }}>
        {tokens.toLocaleString()} / {max.toLocaleString()} tokens ({pct.toFixed(1)}%)
      </span>
    </div>
  );
}
