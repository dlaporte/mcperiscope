import type { Tab } from "../../store";

interface TabBarProps {
  active: Tab;
  onChange: (tab: Tab) => void;
  connected: boolean;
}

const TABS: { id: Tab; label: string; requiresConnection: boolean }[] = [
  { id: "connect", label: "Connect", requiresConnection: false },
  { id: "explore", label: "Explore", requiresConnection: true },
  { id: "optimize", label: "Optimize", requiresConnection: true },
  { id: "results", label: "Results", requiresConnection: true },
];

export function TabBar({ active, onChange, connected }: TabBarProps) {
  return (
    <div
      className="px-4 flex items-center gap-0"
      style={{
        backgroundColor: 'var(--sub-panel)',
        borderBottom: '1px solid var(--sub-rivet)',
      }}
    >
      <span className="font-stencil text-sm font-bold mr-6 py-3" style={{ color: 'var(--sub-brass)' }}>
        MCPeriscope
      </span>
      {TABS.map((tab) => {
        const disabled = tab.requiresConnection && !connected;
        const isActive = active === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => !disabled && onChange(tab.id)}
            disabled={disabled}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              isActive
                ? "text-white"
                : disabled
                  ? "border-transparent cursor-not-allowed"
                  : "border-transparent cursor-pointer"
            }`}
            style={
              isActive
                ? { borderColor: 'var(--sub-brass)', color: 'var(--sub-brass)', textShadow: '0 0 6px rgba(196,154,42,0.4)' }
                : disabled
                  ? { color: 'var(--sub-text-dim)' }
                  : { color: 'var(--sub-text)' }
            }
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
