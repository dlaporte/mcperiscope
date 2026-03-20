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
        className="w-full flex items-center justify-between px-3 py-2 text-sm font-semibold text-gray-300 hover:bg-gray-700"
      >
        <span>
          {open ? "\u25BE" : "\u25B8"} {title}
        </span>
        <span className="text-xs text-gray-500 bg-gray-700 px-1.5 py-0.5 rounded">
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
      <div className="w-64 bg-gray-800 border-r border-gray-700 p-4 text-gray-500 text-sm">
        Connect to an MCP server to explore its capabilities.
      </div>
    );
  }

  const isSelected = (type: string, name: string) =>
    selection?.type === type && selection.item.name === name;

  return (
    <div className="w-64 bg-gray-800 border-r border-gray-700 flex flex-col shrink-0">
      {/* Search filter */}
      <div className="p-2 border-b border-gray-700">
        <div className="relative">
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter..."
            className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-1.5 text-xs text-white placeholder-gray-500 pr-7"
          />
          {filter && (
            <button
              onClick={() => setFilter("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 text-xs"
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
              className={`w-full text-left px-4 py-1.5 text-sm truncate ${
                isSelected("tool", tool.name)
                  ? "bg-blue-600 text-white"
                  : "text-gray-300 hover:bg-gray-700"
              }`}
            >
              {tool.name}
            </button>
          ))}
          {filteredTools.length === 0 && (
            <p className="px-4 py-1 text-xs text-gray-500">
              {query ? "No matches" : "None"}
            </p>
          )}
        </Section>

        <Section title="Resources" count={filteredResources.length} total={resources.length}>
          {filteredResources.map((resource: any) => (
            <button
              key={resource.uri}
              onClick={() => select("resource", resource)}
              className={`w-full text-left px-4 py-1.5 text-sm truncate ${
                isSelected("resource", resource.name)
                  ? "bg-blue-600 text-white"
                  : "text-gray-300 hover:bg-gray-700"
              }`}
            >
              {resource.name || resource.uri}
            </button>
          ))}
          {filteredResources.length === 0 && (
            <p className="px-4 py-1 text-xs text-gray-500">
              {query ? "No matches" : "None"}
            </p>
          )}
        </Section>

        <Section title="Prompts" count={filteredPrompts.length} total={prompts.length}>
          {filteredPrompts.map((prompt: any) => (
            <button
              key={prompt.name}
              onClick={() => select("prompt", prompt)}
              className={`w-full text-left px-4 py-1.5 text-sm truncate ${
                isSelected("prompt", prompt.name)
                  ? "bg-blue-600 text-white"
                  : "text-gray-300 hover:bg-gray-700"
              }`}
            >
              {prompt.name}
            </button>
          ))}
          {filteredPrompts.length === 0 && (
            <p className="px-4 py-1 text-xs text-gray-500">
              {query ? "No matches" : "None"}
            </p>
          )}
        </Section>
      </div>
    </div>
  );
}
