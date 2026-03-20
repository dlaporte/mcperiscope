interface Props {
  tokens: number;
  max: number;
}

export function ContextBudget({ tokens, max }: Props) {
  if (max <= 0) return null;

  const pct = (tokens / max) * 100;
  const color =
    pct > 15 ? "bg-red-500" : pct > 5 ? "bg-yellow-500" : "bg-green-500";

  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className="flex-1 h-2.5 bg-gray-700 rounded-full overflow-hidden min-w-[80px]">
        <div
          className={`h-full ${color} rounded-full transition-all duration-300`}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
      <span className="text-xs text-gray-400 whitespace-nowrap">
        {tokens.toLocaleString()} / {max.toLocaleString()} tokens ({pct.toFixed(1)}%)
      </span>
    </div>
  );
}
