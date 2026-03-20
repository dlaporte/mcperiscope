type Tab = "connect" | "explore" | "optimize" | "results";

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
    <div className="bg-gray-800 border-b border-gray-700 px-4 flex items-center gap-0">
      <span className="text-sm font-bold text-white mr-6 py-3">MCPeriscope</span>
      {TABS.map((tab) => {
        const disabled = tab.requiresConnection && !connected;
        const isActive = active === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => !disabled && onChange(tab.id)}
            disabled={disabled}
            className={`
              px-4 py-3 text-sm font-medium border-b-2 transition-colors
              ${isActive
                ? "border-blue-500 text-white"
                : disabled
                  ? "border-transparent text-gray-600 cursor-not-allowed"
                  : "border-transparent text-gray-400 hover:text-gray-200 hover:border-gray-600 cursor-pointer"
              }
            `}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
