import type { ReactNode } from "react";

// "Session usage" header strip that hosts a context gauge
export function UsageBar({ children }: { children: ReactNode }) {
  return (
    <div
      className="flex items-center gap-4 px-4 py-3"
      style={{ backgroundColor: 'var(--sub-panel)', borderBottom: '1px solid var(--sub-rivet)' }}
    >
      <span className="font-stencil text-xs whitespace-nowrap" style={{ color: 'var(--sub-text-dim)' }}>
        Session usage
      </span>
      {children}
    </div>
  );
}
