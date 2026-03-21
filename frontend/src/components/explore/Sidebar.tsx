import { useState, useMemo } from "react";
import { useStore } from "../../store";

function Section({
  title,
  count,
  total,
  children,
}: {
  title: string;
  count: number;
  total: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2 text-sm font-semibold"
        style={{ color: 'var(--sub-text)' }}
        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--sub-panel-light)')}
        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
      >
        <span>
          {open ? "\u25BE" : "\u25B8"} {title}
        </span>
        <span
          className="text-xs px-1.5 py-0.5 rounded"
          style={{ backgroundColor: 'var(--sub-panel-light)', color: 'var(--sub-text-dim)' }}
        >
          {count !== total ? `${count}/${total}` : count}
        </span>
      </button>
      {open && <div>{children}</div>}
    </div>
  );
}

export function Sidebar() {
  const { connected, tools, resources, prompts, selection, select } =
    useStore();
  const [filter, setFilter] = useState("");

  const query = filter.toLowerCase().trim();

  const filteredTools = useMemo(
    () =>
      query
        ? tools.filter(
            (t: any) =>
              t.name.toLowerCase().includes(query) ||
              (t.description || "").toLowerCase().includes(query)
          )
        : tools,
    [tools, query]
  );

  const filteredResources = useMemo(
    () =>
      query
        ? resources.filter(
            (r: any) =>
              (r.name || "").toLowerCase().includes(query) ||
              (r.uri || "").toLowerCase().includes(query) ||
              (r.description || "").toLowerCase().includes(query)
          )
        : resources,
    [resources, query]
  );

  const filteredPrompts = useMemo(
    () =>
      query
        ? prompts.filter(
            (p: any) =>
              p.name.toLowerCase().includes(query) ||
              (p.description || "").toLowerCase().includes(query)
          )
        : prompts,
    [prompts, query]
  );

  if (!connected) {
    return (
      <div
        className="w-64 p-4 text-sm"
        style={{ backgroundColor: 'var(--sub-panel)', borderRight: '1px solid var(--sub-rivet)', color: 'var(--sub-text-dim)' }}
      >
        Connect to an MCP server to explore its capabilities.
      </div>
    );
  }

  const isSelected = (type: string, name: string) =>
    selection?.type === type && selection.item.name === name;

  return (
    <div
      className="w-64 flex flex-col shrink-0"
      style={{ backgroundColor: 'var(--sub-panel)', borderRight: '1px solid var(--sub-rivet)' }}
    >
      {/* Search filter */}
      <div className="p-2" style={{ borderBottom: '1px solid var(--sub-rivet)' }}>
        <div className="relative">
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter..."
            className="w-full rounded px-3 py-1.5 text-xs placeholder-gray-500 pr-7"
            style={{ backgroundColor: 'var(--sub-hull)', border: '1px solid var(--sub-rivet)', color: 'var(--sub-text)' }}
          />
          {filter && (
            <button
              onClick={() => setFilter("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-xs"
              style={{ color: 'var(--sub-text-dim)' }}
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Scrollable list */}
      <div className="overflow-y-auto flex-1">
        <Section title="Tools" count={filteredTools.length} total={tools.length}>
          {filteredTools.map((tool: any) => (
            <button
              key={tool.name}
              onClick={() => select("tool", tool)}
              className="w-full text-left px-4 py-1.5 text-sm truncate"
              style={
                isSelected("tool", tool.name)
                  ? { backgroundColor: 'var(--sub-brass)', color: 'white' }
                  : { color: 'var(--sub-text)' }
              }
              onMouseEnter={(e) => {
                if (!isSelected("tool", tool.name))
                  e.currentTarget.style.backgroundColor = 'var(--sub-panel-light)';
              }}
              onMouseLeave={(e) => {
                if (!isSelected("tool", tool.name))
                  e.currentTarget.style.backgroundColor = 'transparent';
              }}
            >
              {tool.name}
            </button>
          ))}
          {filteredTools.length === 0 && (
            <p className="px-4 py-1 text-xs" style={{ color: 'var(--sub-text-dim)' }}>
              {query ? "No matches" : "None"}
            </p>
          )}
        </Section>

        <Section title="Resources" count={filteredResources.length} total={resources.length}>
          {filteredResources.map((resource: any) => (
            <button
              key={resource.uri}
              onClick={() => select("resource", resource)}
              className="w-full text-left px-4 py-1.5 text-sm truncate"
              style={
                isSelected("resource", resource.name)
                  ? { backgroundColor: 'var(--sub-brass)', color: 'white' }
                  : { color: 'var(--sub-text)' }
              }
              onMouseEnter={(e) => {
                if (!isSelected("resource", resource.name))
                  e.currentTarget.style.backgroundColor = 'var(--sub-panel-light)';
              }}
              onMouseLeave={(e) => {
                if (!isSelected("resource", resource.name))
                  e.currentTarget.style.backgroundColor = 'transparent';
              }}
            >
              {resource.name || resource.uri}
            </button>
          ))}
          {filteredResources.length === 0 && (
            <p className="px-4 py-1 text-xs" style={{ color: 'var(--sub-text-dim)' }}>
              {query ? "No matches" : "None"}
            </p>
          )}
        </Section>

        <Section title="Prompts" count={filteredPrompts.length} total={prompts.length}>
          {filteredPrompts.map((prompt: any) => (
            <button
              key={prompt.name}
              onClick={() => select("prompt", prompt)}
              className="w-full text-left px-4 py-1.5 text-sm truncate"
              style={
                isSelected("prompt", prompt.name)
                  ? { backgroundColor: 'var(--sub-brass)', color: 'white' }
                  : { color: 'var(--sub-text)' }
              }
              onMouseEnter={(e) => {
                if (!isSelected("prompt", prompt.name))
                  e.currentTarget.style.backgroundColor = 'var(--sub-panel-light)';
              }}
              onMouseLeave={(e) => {
                if (!isSelected("prompt", prompt.name))
                  e.currentTarget.style.backgroundColor = 'transparent';
              }}
            >
              {prompt.name}
            </button>
          ))}
          {filteredPrompts.length === 0 && (
            <p className="px-4 py-1 text-xs" style={{ color: 'var(--sub-text-dim)' }}>
              {query ? "No matches" : "None"}
            </p>
          )}
        </Section>
      </div>
    </div>
  );
}
