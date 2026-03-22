interface Run {
  id: string;
  name: string;
  timestamp: number;
}

interface Props {
  runs: Run[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function RunSelector({ runs, selectedId, onSelect }: Props) {
  if (runs.length === 0) return null;
  if (runs.length === 1) {
    return <span className="text-sm font-medium" style={{ color: 'var(--sub-text-dim)' }}>{runs[0].name}</span>;
  }

  return (
    <select
      value={selectedId || ""}
      onChange={(e) => onSelect(e.target.value)}
      className="text-xs font-mono px-2 py-1 rounded border cursor-pointer"
      style={{
        backgroundColor: 'var(--sub-hull)',
        borderColor: 'var(--sub-rivet)',
        color: 'var(--sub-text)',
      }}
    >
      {runs.map((run) => (
        <option key={run.id} value={run.id}>
          {run.name}
        </option>
      ))}
    </select>
  );
}
