interface MetricSet {
  tool_count?: number;
  menu_tokens?: number;
  avg_tokens_per_prompt?: number;
  avg_calls_per_prompt?: number;
  total_context?: number;
  accuracy?: number;
  avg_latency?: number;
}

interface DeltaEntry {
  value?: number;
  pct?: number;
}

interface ComparisonData {
  baseline: MetricSet;
  proxy: MetricSet;
  delta?: Record<string, DeltaEntry>;
}

interface Props {
  data: ComparisonData;
  runSelector?: React.ReactNode;
}

interface RowDef {
  label: string;
  key: keyof MetricSet;
  format: (v: number | undefined) => string;
  lowerBetter?: boolean;
  isPercent?: boolean; // already a percentage (accuracy, error_rate)
}

const rows: RowDef[] = [
  {
    label: "Tool Count",
    key: "tool_count",
    format: (v) => (v != null ? String(v) : "\u2014"),
    lowerBetter: true,
  },
  {
    label: "Menu Tokens",
    key: "menu_tokens",
    format: (v) => (v != null ? v.toLocaleString() : "\u2014"),
    lowerBetter: true,
  },
  {
    label: "Avg Tokens / Prompt",
    key: "avg_tokens_per_prompt",
    format: (v) => (v != null ? v.toLocaleString() : "\u2014"),
    lowerBetter: true,
  },
  {
    label: "Avg Calls / Prompt",
    key: "avg_calls_per_prompt",
    format: (v) => (v != null ? Number(v).toFixed(1) : "\u2014"),
    lowerBetter: true,
  },
  {
    label: "Accuracy",
    key: "accuracy",
    format: (v) => (v != null ? `${(v * 100).toFixed(0)}%` : "\u2014"),
    lowerBetter: false,
    isPercent: true,
  },
  {
    label: "Avg Latency",
    key: "avg_latency",
    format: (v) => (v != null ? `${v.toFixed(0)}ms` : "\u2014"),
    lowerBetter: true,
  },
];

function deltaStyle(pct: number | undefined, lowerBetter: boolean): React.CSSProperties {
  if (pct == null || pct === 0) return { color: 'var(--sub-text-dim)' };
  const improved = lowerBetter ? pct < 0 : pct > 0;
  return { color: improved ? 'var(--sub-phosphor)' : 'var(--sub-red)' };
}

function formatDelta(delta: DeltaEntry | undefined, row: RowDef, baseline: number | undefined, proxy: number | undefined): string {
  // If we have structured delta with pct, use it
  if (delta?.pct != null) {
    const sign = delta.pct > 0 ? "+" : "";
    return `${sign}${delta.pct.toFixed(1)}%`;
  }

  // Calculate from baseline/proxy
  if (baseline == null || proxy == null) return "\u2014";
  if (baseline === 0 && proxy === 0) return "0%";

  if (row.isPercent) {
    // For accuracy/error_rate, show percentage point change
    const diff = (proxy - baseline) * 100;
    if (diff === 0) return "0";
    const sign = diff > 0 ? "+" : "";
    return `${sign}${diff.toFixed(1)}pp`;
  }

  if (baseline === 0) return proxy > 0 ? "+\u221e" : "0%";
  const pct = ((proxy - baseline) / baseline) * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

function getDeltaPct(delta: DeltaEntry | undefined, baseline: number | undefined, proxy: number | undefined, isPercent?: boolean): number | undefined {
  if (delta?.pct != null) return delta.pct;
  if (baseline == null || proxy == null) return undefined;
  if (isPercent) return (proxy - baseline) * 100;
  if (baseline === 0) return undefined;
  return ((proxy - baseline) / baseline) * 100;
}

export function ComparisonTable({ data, runSelector }: Props) {
  return (
    <div className="panel-riveted rounded-lg overflow-hidden">
      <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--sub-rivet)' }}>
        <h3 className="text-lg font-semibold font-stencil" style={{ color: 'var(--sub-text)' }}>Before / After Comparison</h3>

      </div>
      <table className="w-full">
        <thead>
          <tr className="text-sm" style={{ borderBottom: '1px solid var(--sub-rivet)' }}>
            <th className="text-left px-4 py-2 font-medium" style={{ color: 'var(--sub-text-dim)' }}>Metric</th>
            <th className="text-right px-4 py-2 font-medium" style={{ color: 'var(--sub-text-dim)' }}>Baseline</th>
            <th className="text-right px-4 py-2 font-medium" style={{ color: 'var(--sub-text-dim)' }}>
              {runSelector || "Optimized"}
            </th>
            <th className="text-right px-4 py-2 font-medium" style={{ color: 'var(--sub-text-dim)' }}>Change</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const baseline = data.baseline?.[row.key];
            const proxy = data.proxy?.[row.key];
            const delta = data.delta?.[row.key as string] as DeltaEntry | undefined;
            const pct = getDeltaPct(delta, baseline, proxy, row.isPercent);
            return (
              <tr
                key={row.key}
                style={{ borderBottom: '1px solid rgba(74,78,80,0.5)' }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--sub-panel-light)')}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
              >
                <td className="px-4 py-2.5 font-medium" style={{ color: 'var(--sub-text)' }}>
                  {row.label}
                </td>
                <td className="px-4 py-2.5 text-right font-mono text-sm" style={{ color: 'var(--sub-text)' }}>
                  {row.format(baseline)}
                </td>
                <td className="px-4 py-2.5 text-right font-mono text-sm" style={{ color: 'var(--sub-text)' }}>
                  {row.format(proxy)}
                </td>
                <td
                  className="px-4 py-2.5 text-right font-mono text-sm font-semibold"
                  style={deltaStyle(pct, !!row.lowerBetter)}
                >
                  {formatDelta(delta, row, baseline, proxy)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
