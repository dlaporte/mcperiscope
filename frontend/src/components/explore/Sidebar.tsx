import { useState, useMemo } from "react";
import { useStore } from "../../store";

type SortMode = "name" | "tokens";

function Section({
  title,
  tokens,
  sortable,
  sortMode,
  onToggleSort,
  children,
}: {
  title: string;
  tokens?: number;
  sortable?: boolean;
  sortMode?: SortMode;
  onToggleSort?: () => void;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="w-full flex items-center justify-between px-3 py-2 text-sm font-semibold"
        style={{ color: 'var(--sub-text)' }}
        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--sub-panel-light)')}
        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
      >
        <span className="flex items-center gap-1.5">
          {open ? "\u25BE" : "\u25B8"} {title}
          {sortable && open && (
            <span
              className="text-[10px] font-mono px-1 py-0.5 rounded cursor-pointer"
              style={{ backgroundColor: 'var(--sub-hull)', color: 'var(--sub-text-dim)' }}
              onClick={(e) => { e.stopPropagation(); onToggleSort?.(); }}
              title={`Sort by ${sortMode === "name" ? "tokens" : "name"}`}
            >
              {sortMode === "tokens" ? "\u25BE tok" : "A\u2193Z"}
            </span>
          )}
        </span>
        {tokens != null && tokens > 0 && (
          <span
            className="text-[10px] font-mono px-1.5 py-0.5 rounded-full"
            style={{ backgroundColor: 'var(--sub-panel-light)', color: 'var(--sub-text-dim)' }}
          >
            {tokens.toLocaleString()}
          </span>
        )}
      </button>
      {open && <div>{children}</div>}
    </div>
  );
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function estimateToolTokens(tool: any): number {
  const desc = tool.description || "";
  const schema = JSON.stringify(tool.inputSchema || {});
  return estimateTokens(`${tool.name}: ${desc}`) + estimateTokens(schema);
}

function estimateResourceTokens(resource: any): number {
  return estimateTokens(`${resource.name || ""}: ${resource.description || ""} (${resource.uri || ""})`);
}

function estimatePromptTokens(prompt: any): number {
  const args = (prompt.arguments || []).map((a: any) => a.name).join(", ");
  return estimateTokens(`${prompt.name}(${args}): ${prompt.description || ""}`);
}

export function Sidebar() {
  const { connected, tools, resources, prompts, selection, select, inventory } =
    useStore();
  const [filter, setFilter] = useState("");
  const [toolSort, setToolSort] = useState<SortMode>("name");
  const [resourceSort, setResourceSort] = useState<SortMode>("name");
  const [promptSort, setPromptSort] = useState<SortMode>("name");

  const query = filter.toLowerCase().trim();

  // Pre-compute token counts
  const toolsWithTokens = useMemo(
    () => tools.map((t: any) => ({ item: t, tokens: estimateToolTokens(t) })),
    [tools]
  );

  const resourcesWithTokens = useMemo(
    () => resources.map((r: any) => ({ item: r, tokens: estimateResourceTokens(r) })),
    [resources]
  );

  const promptsWithTokens = useMemo(
    () => prompts.map((p: any) => ({ item: p, tokens: estimatePromptTokens(p) })),
    [prompts]
  );

  const filteredTools = useMemo(() => {
    let result = query
      ? toolsWithTokens.filter(
          ({ item: t }: any) =>
            t.name.toLowerCase().includes(query) ||
            (t.description || "").toLowerCase().includes(query)
        )
      : toolsWithTokens;

    if (toolSort === "tokens") {
      result = [...result].sort((a, b) => b.tokens - a.tokens);
    } else {
      result = [...result].sort((a, b) => a.item.name.localeCompare(b.item.name));
    }
    return result;
  }, [toolsWithTokens, query, toolSort]);

  const filteredResources = useMemo(() => {
    let result = query
      ? resourcesWithTokens.filter(
          ({ item: r }: any) =>
            (r.name || "").toLowerCase().includes(query) ||
            (r.uri || "").toLowerCase().includes(query) ||
            (r.description || "").toLowerCase().includes(query)
        )
      : resourcesWithTokens;

    if (resourceSort === "tokens") {
      result = [...result].sort((a, b) => b.tokens - a.tokens);
    } else {
      result = [...result].sort((a, b) => (a.item.name || "").localeCompare(b.item.name || ""));
    }
    return result;
  }, [resourcesWithTokens, query, resourceSort]);

  const filteredPrompts = useMemo(() => {
    let result = query
      ? promptsWithTokens.filter(
          ({ item: p }: any) =>
            p.name.toLowerCase().includes(query) ||
            (p.description || "").toLowerCase().includes(query)
        )
      : promptsWithTokens;

    if (promptSort === "tokens") {
      result = [...result].sort((a, b) => b.tokens - a.tokens);
    } else {
      result = [...result].sort((a, b) => a.item.name.localeCompare(b.item.name));
    }
    return result;
  }, [promptsWithTokens, query, promptSort]);

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

  // Use backend-reported totals when available (matches the inventory bar); fall back to client estimates when filtering
  const toolTokens = !query && inventory?.toolTokens != null
    ? inventory.toolTokens
    : filteredTools.reduce((sum: number, { tokens }: any) => sum + tokens, 0);
  const resourceTokens = !query && inventory?.resourceTokens != null
    ? inventory.resourceTokens
    : filteredResources.reduce((sum: number, { tokens }: any) => sum + tokens, 0);
  const promptTokens = !query && inventory?.promptTokens != null
    ? inventory.promptTokens
    : filteredPrompts.reduce((sum: number, { tokens }: any) => sum + tokens, 0);

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
            className="w-full input-sub border rounded px-3 py-1.5 text-xs  pr-7"
          />
          {filter && (
            <button
              onClick={() => setFilter("")}
              className="absolute right-1 top-1/2 -translate-y-1/2 p-1 rounded text-xs"
              aria-label="Clear filter"
              style={{ color: 'var(--sub-text-dim)' }}
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Column headers */}
      <div
        className="flex items-center justify-between px-4 py-1.5"
        style={{ borderBottom: '1px solid var(--sub-rivet)' }}
      >
        <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--sub-text-dim)' }}>
          Name
        </span>
        <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--sub-text-dim)' }}>
          Tokens
        </span>
      </div>

      {/* Scrollable list */}
      <div className="overflow-y-auto flex-1">
        <Section
          title="Tools"
          tokens={toolTokens}
          sortable
          sortMode={toolSort}
          onToggleSort={() => setToolSort(toolSort === "name" ? "tokens" : "name")}
        >
          {filteredTools.map(({ item, tokens }: any) => (
            <button
              key={item.name}
              onClick={() => select("tool", item)}
              title={item.name}
              className="w-full text-left pl-6 pr-4 py-1.5 text-xs flex items-center justify-between gap-1"
              style={
                isSelected("tool", item.name)
                  ? { backgroundColor: 'var(--sub-brass)', color: 'white' }
                  : { color: 'var(--sub-text)' }
              }
              onMouseEnter={(e) => {
                if (!isSelected("tool", item.name))
                  e.currentTarget.style.backgroundColor = 'var(--sub-panel-light)';
              }}
              onMouseLeave={(e) => {
                if (!isSelected("tool", item.name))
                  e.currentTarget.style.backgroundColor = 'transparent';
              }}
            >
              <span className="truncate">{item.name}</span>
              <span
                className="text-[10px] font-mono shrink-0"
                style={
                  isSelected("tool", item.name)
                    ? { color: 'rgba(255,255,255,0.7)' }
                    : { color: 'var(--sub-text-dim)' }
                }
              >
                {tokens}
              </span>
            </button>
          ))}
          {filteredTools.length === 0 && (
            <p className="px-4 py-1 text-xs" style={{ color: 'var(--sub-text-dim)' }}>
              {query ? "No matches" : "None"}
            </p>
          )}
        </Section>

        <Section
          title="Resource Definitions"
          tokens={resourceTokens}
          sortable
          sortMode={resourceSort}
          onToggleSort={() => setResourceSort(resourceSort === "name" ? "tokens" : "name")}
        >
          {filteredResources.map(({ item: resource, tokens }: any) => (
            <button
              key={resource.uri}
              onClick={() => select("resource", resource)}
              title={resource.name || resource.uri}
              className="w-full text-left pl-6 pr-4 py-1.5 text-xs flex items-center justify-between gap-1"
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
              <span className="truncate">{resource.name || resource.uri}</span>
              <span
                className="text-[10px] font-mono shrink-0"
                style={
                  isSelected("resource", resource.name)
                    ? { color: 'rgba(255,255,255,0.7)' }
                    : { color: 'var(--sub-text-dim)' }
                }
              >
                {tokens}
              </span>
            </button>
          ))}
          {filteredResources.length === 0 && (
            <p className="px-4 py-1 text-xs" style={{ color: 'var(--sub-text-dim)' }}>
              {query ? "No matches" : "None"}
            </p>
          )}
        </Section>

        <Section
          title="Prompts"
          tokens={promptTokens}
          sortable
          sortMode={promptSort}
          onToggleSort={() => setPromptSort(promptSort === "name" ? "tokens" : "name")}
        >
          {filteredPrompts.map(({ item: prompt, tokens }: any) => (
            <button
              key={prompt.name}
              onClick={() => select("prompt", prompt)}
              title={prompt.name}
              className="w-full text-left pl-6 pr-4 py-1.5 text-xs flex items-center justify-between gap-1"
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
              <span className="truncate">{prompt.name}</span>
              <span
                className="text-[10px] font-mono shrink-0"
                style={
                  isSelected("prompt", prompt.name)
                    ? { color: 'rgba(255,255,255,0.7)' }
                    : { color: 'var(--sub-text-dim)' }
                }
              >
                {tokens}
              </span>
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
