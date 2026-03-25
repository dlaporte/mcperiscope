import { useState, useMemo } from "react";
import { useStore } from "../../store";

function SectionHeader({
  title,
  count,
  onSelectAll,
  onDeselectAll,
}: {
  title: string;
  count: number;
  onSelectAll: () => void;
  onDeselectAll: () => void;
}) {
  return (
    <div className="flex items-center justify-between px-1 py-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--sub-text-dim)' }}>
        {title} ({count})
      </span>
      {count > 0 && (
        <div className="flex items-center gap-2 text-[10px]">
          <button onClick={onSelectAll} style={{ color: 'var(--sub-brass)' }} className="hover:underline">
            Select All
          </button>
          <span style={{ color: 'var(--sub-text-dim)' }}>/</span>
          <button onClick={onDeselectAll} style={{ color: 'var(--sub-brass)' }} className="hover:underline">
            Deselect All
          </button>
        </div>
      )}
    </div>
  );
}

function InventoryItem({
  label,
  checked,
  onToggle,
}: {
  label: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      className="flex items-center gap-2 py-0.5 px-1 rounded cursor-pointer transition-colors"
      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--sub-panel-light)')}
      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
      onClick={onToggle}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        onClick={(e) => e.stopPropagation()}
        className="w-3 h-3 rounded cursor-pointer accent-amber-600 shrink-0"
      />
      <span
        className="text-[11px] truncate"
        style={{ color: checked ? 'var(--sub-text)' : 'var(--sub-text-dim)' }}
      >
        {label}
      </span>
    </div>
  );
}

export function InventoryPanel() {
  const tools = useStore((s) => s.tools);
  const resources = useStore((s) => s.resources);
  const prompts = useStore((s) => s.prompts);
  const disabledTools = useStore((s) => s.disabledTools);
  const disabledResources = useStore((s) => s.disabledResources);
  const disabledPrompts = useStore((s) => s.disabledPrompts);
  const toggleDisabledTool = useStore((s) => s.toggleDisabledTool);
  const toggleDisabledResource = useStore((s) => s.toggleDisabledResource);
  const toggleDisabledPrompt = useStore((s) => s.toggleDisabledPrompt);
  const setAllToolsEnabled = useStore((s) => s.setAllToolsEnabled);
  const setAllResourcesEnabled = useStore((s) => s.setAllResourcesEnabled);
  const setAllPromptsEnabled = useStore((s) => s.setAllPromptsEnabled);

  const [filter, setFilter] = useState("");
  const filterLower = filter.toLowerCase();

  const filteredTools = useMemo(
    () => tools.filter((t: any) => !filterLower || t.name.toLowerCase().includes(filterLower)),
    [tools, filterLower],
  );

  const filteredResources = useMemo(
    () => resources.filter((r: any) => {
      const label = r.name || r.uri || "";
      return !filterLower || label.toLowerCase().includes(filterLower);
    }),
    [resources, filterLower],
  );

  const filteredPrompts = useMemo(
    () => prompts.filter((p: any) => !filterLower || p.name.toLowerCase().includes(filterLower)),
    [prompts, filterLower],
  );

  return (
    <div className="flex flex-col h-full">
      {/* Filter */}
      <div className="px-2 py-2">
        <input
          type="text"
          placeholder="Filter..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-full px-2 py-1 rounded text-xs"
          style={{
            backgroundColor: 'var(--sub-hull)',
            color: 'var(--sub-text)',
            border: '1px solid var(--sub-rivet)',
          }}
        />
      </div>

      {/* Scrollable list */}
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {/* Tools */}
        <SectionHeader
          title="Tools"
          count={tools.length}
          onSelectAll={() => setAllToolsEnabled(true)}
          onDeselectAll={() => setAllToolsEnabled(false)}
        />
        {filteredTools.length === 0 && (
          <p className="text-[10px] px-1 py-1" style={{ color: 'var(--sub-text-dim)' }}>
            {tools.length === 0 ? "(none)" : "No matches"}
          </p>
        )}
        {filteredTools.map((t: any) => (
          <InventoryItem
            key={t.name}
            label={t.name}
            checked={!disabledTools.has(t.name)}
            onToggle={() => toggleDisabledTool(t.name)}
          />
        ))}

        {/* Resources */}
        <div className="mt-2">
          <SectionHeader
            title="Resources"
            count={resources.length}
            onSelectAll={() => setAllResourcesEnabled(true)}
            onDeselectAll={() => setAllResourcesEnabled(false)}
          />
          {filteredResources.length === 0 && (
            <p className="text-[10px] px-1 py-1" style={{ color: 'var(--sub-text-dim)' }}>
              {resources.length === 0 ? "(none)" : "No matches"}
            </p>
          )}
          {filteredResources.map((r: any) => (
            <InventoryItem
              key={r.uri}
              label={r.name || r.uri}
              checked={!disabledResources.has(r.uri)}
              onToggle={() => toggleDisabledResource(r.uri)}
            />
          ))}
        </div>

        {/* Prompts */}
        <div className="mt-2">
          <SectionHeader
            title="Prompts"
            count={prompts.length}
            onSelectAll={() => setAllPromptsEnabled(true)}
            onDeselectAll={() => setAllPromptsEnabled(false)}
          />
          {filteredPrompts.length === 0 && (
            <p className="text-[10px] px-1 py-1" style={{ color: 'var(--sub-text-dim)' }}>
              {prompts.length === 0 ? "(none)" : "No matches"}
            </p>
          )}
          {filteredPrompts.map((p: any) => (
            <InventoryItem
              key={p.name}
              label={p.name}
              checked={!disabledPrompts.has(p.name)}
              onToggle={() => toggleDisabledPrompt(p.name)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
