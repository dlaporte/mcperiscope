interface MetricSet {
  tool_count?: number;
  menu_tokens?: number;
  avg_tokens_per_prompt?: number;
  avg_calls_per_prompt?: number;
  accuracy?: number;
  error_rate?: number;
}

interface ComparisonData {
  baseline: MetricSet;
  proxy: MetricSet;
  delta: MetricSet;
  accuracy_warning?: string;
}

interface Props {
  data: ComparisonData;
}

interface RowDef {
  label: string;
  key: keyof MetricSet;
  format: (v: number | undefined) => string;
  /** true = lower is better (e.g., error rate, tokens) */
  lowerBetter?: boolean;
}

const rows: RowDef[] = [
  {
    label: "Tool Count",
    key: "tool_count",
    format: (v) => (v != null ? String(v) : "-"),
    lowerBetter: true,
  },
  {
    label: "Menu Tokens",
    key: "menu_tokens",
    format: (v) => (v != null ? v.toLocaleString() : "-"),
    lowerBetter: true,
  },
  {
    label: "Avg Tokens / Prompt",
    key: "avg_tokens_per_prompt",
    format: (v) => (v != null ? v.toLocaleString() : "-"),
    lowerBetter: true,
  },
  {
    label: "Avg Calls / Prompt",
    key: "avg_calls_per_prompt",
    format: (v) => (v != null ? Number(v).toFixed(1) : "-"),
    lowerBetter: true,
  },
  {
    label: "Accuracy",
    key: "accuracy",
    format: (v) => (v != null ? `${(v * 100).toFixed(1)}%` : "-"),
    lowerBetter: false,
  },
  {
    label: "Error Rate",
    key: "error_rate",
    format: (v) => (v != null ? `${(v * 100).toFixed(1)}%` : "-"),
    lowerBetter: true,
  },
];

function deltaStyle(delta: number | undefined, lowerBetter: boolean): React.CSSProperties {
  if (delta == null || delta === 0) return { color: 'var(--sub-text-dim)' };
  const improved = lowerBetter ? delta < 0 : delta > 0;
  return { color: improved ? 'var(--sub-phosphor)' : 'var(--sub-red)' };
}

function formatDelta(delta: number | undefined, row: RowDef): string {
  if (delta == null) return "-";
  if (delta === 0) return "0";
  const sign = delta > 0 ? "+" : "";
  if (row.key === "accuracy" || row.key === "error_rate") {
    return `${sign}${(delta * 100).toFixed(1)}%`;
  }
  if (Number.isInteger(delta)) {
    return `${sign}${delta.toLocaleString()}`;
  }
  return `${sign}${delta.toFixed(1)}`;
}

export function ComparisonTable({ data }: Props) {
  return (
    <div className="panel-riveted rounded-lg overflow-hidden">
      <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--sub-rivet)' }}>
        <h3 className="text-lg font-semibold font-stencil" style={{ color: 'var(--sub-text)' }}>Before / After Comparison</h3>
        {data.accuracy_warning && (
          <p className="text-sm mt-1" style={{ color: 'var(--sub-brass)' }}>{data.accuracy_warning}</p>
        )}
      </div>
      <table className="w-full">
        <thead>
          <tr className="text-sm" style={{ borderBottom: '1px solid var(--sub-rivet)' }}>
            <th className="text-left px-4 py-2 font-medium" style={{ color: 'var(--sub-text-dim)' }}>Metric</th>
            <th className="text-right px-4 py-2 font-medium" style={{ color: 'var(--sub-text-dim)' }}>Baseline</th>
            <th className="text-right px-4 py-2 font-medium" style={{ color: 'var(--sub-text-dim)' }}>Optimized</th>
            <th className="text-right px-4 py-2 font-medium" style={{ color: 'var(--sub-text-dim)' }}>Delta</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const baseline = data.baseline?.[row.key];
            const proxy = data.proxy?.[row.key];
            const delta = data.delta?.[row.key];
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
                  style={deltaStyle(delta, !!row.lowerBetter)}
                >
                  {formatDelta(delta, row)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
