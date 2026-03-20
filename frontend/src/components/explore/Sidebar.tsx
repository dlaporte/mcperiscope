import { useState } from "react";
import { useStore } from "../../store";

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
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
          {count}
        </span>
      </button>
      {open && <div>{children}</div>}
    </div>
  );
}

export function Sidebar() {
  const { connected, tools, resources, prompts, selection, select } =
    useStore();

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
    <div className="w-64 bg-gray-800 border-r border-gray-700 overflow-y-auto shrink-0">
      <Section title="Tools" count={tools.length}>
        {tools.map((tool: any) => (
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
        {tools.length === 0 && (
          <p className="px-4 py-1 text-xs text-gray-500">None</p>
        )}
      </Section>

      <Section title="Resources" count={resources.length}>
        {resources.map((resource: any) => (
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
        {resources.length === 0 && (
          <p className="px-4 py-1 text-xs text-gray-500">None</p>
        )}
      </Section>

      <Section title="Prompts" count={prompts.length}>
        {prompts.map((prompt: any) => (
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
        {prompts.length === 0 && (
          <p className="px-4 py-1 text-xs text-gray-500">None</p>
        )}
      </Section>
    </div>
  );
}
