import { useEffect, useState } from "react";

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

function deltaColor(delta: number | undefined, lowerBetter: boolean): string {
  if (delta == null || delta === 0) return "text-gray-400";
  const improved = lowerBetter ? delta < 0 : delta > 0;
  return improved ? "text-green-400" : "text-red-400";
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
    <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-700">
        <h3 className="text-lg font-semibold text-white">Before / After Comparison</h3>
        {data.accuracy_warning && (
          <p className="text-sm text-yellow-400 mt-1">{data.accuracy_warning}</p>
        )}
      </div>
      <table className="w-full">
        <thead>
          <tr className="text-gray-400 text-sm border-b border-gray-700">
            <th className="text-left px-4 py-2 font-medium">Metric</th>
            <th className="text-right px-4 py-2 font-medium">Baseline</th>
            <th className="text-right px-4 py-2 font-medium">Optimized</th>
            <th className="text-right px-4 py-2 font-medium">Delta</th>
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
                className="border-b border-gray-700/50 hover:bg-gray-700/30"
              >
                <td className="px-4 py-2.5 text-gray-300 font-medium">
                  {row.label}
                </td>
                <td className="px-4 py-2.5 text-right text-gray-300 font-mono text-sm">
                  {row.format(baseline)}
                </td>
                <td className="px-4 py-2.5 text-right text-gray-300 font-mono text-sm">
                  {row.format(proxy)}
                </td>
                <td
                  className={`px-4 py-2.5 text-right font-mono text-sm font-semibold ${deltaColor(delta, !!row.lowerBetter)}`}
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
