import { useState, useMemo } from "react";
import { useStore, selectLoadedResourceTokens } from "../../store";

type SortMode = "name" | "tokens";

export function ResourcePicker() {
  const resources = useStore((s) => s.resources);
  const loadedResources = useStore((s) => s.loadedResources);
  const toggleResource = useStore((s) => s.toggleResource);
  const totalTokens = useStore(selectLoadedResourceTokens);
  const [open, setOpen] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("name");

  const loadedUris = new Set(loadedResources.map((r) => r.uri));
  const loadedCount = loadedResources.length;

  const sortedResources = useMemo(() => {
    // Content tokens are only known once a resource is loaded
    const loadedTokens = new Map(loadedResources.map((lr) => [lr.uri, lr.tokens]));
    const withTokens: { resource: any; tokens: number | null }[] = resources.map((r: any) => ({
      resource: r,
      tokens: loadedTokens.get(r.uri) ?? null,
    }));
    if (sortMode === "tokens") {
      // Loaded by size, then unloaded by name
      return [...withTokens].sort((a, b) =>
        a.tokens !== null && b.tokens !== null ? b.tokens - a.tokens
          : a.tokens !== null ? -1
            : b.tokens !== null ? 1
              : (a.resource.name || "").localeCompare(b.resource.name || ""));
    }
    return [...withTokens].sort((a, b) => (a.resource.name || "").localeCompare(b.resource.name || ""));
  }, [resources, loadedResources, sortMode]);

  if (resources.length === 0) return null;

  const handleToggleAll = async () => {
    setToggling(true);
    try {
      if (loadedCount > 0) {
        // Unload all loaded
        for (const r of [...loadedResources]) {
          await toggleResource(r.uri);
        }
      } else {
        // Load all
        for (const r of resources) {
          if (!loadedUris.has(r.uri)) await toggleResource(r.uri);
        }
      }
    } finally {
      setToggling(false);
    }
  };

  return (
    <div className="px-4 py-2" style={{ borderBottom: '1px solid var(--sub-rivet)' }}>
      {/* The toggle covers the whole header; the sort toggle sits above it as a sibling button */}
      <div className="relative flex items-center gap-2 text-sm font-medium w-full" style={{ color: 'var(--sub-text)' }}>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-label="Resources"
          className="absolute inset-0 w-full"
        />
        <span className="pointer-events-none" aria-hidden="true">{open ? "\u25BE" : "\u25B8"}</span>
        <span className="flex items-center gap-1.5 pointer-events-none">
          Resources
          {open && (
            <button
              type="button"
              className="relative text-[10px] font-mono px-1 py-0.5 rounded pointer-events-auto"
              style={{ backgroundColor: 'var(--sub-hull)', color: 'var(--sub-text-dim)' }}
              onClick={() => setSortMode(sortMode === "name" ? "tokens" : "name")}
              title={`Sort by ${sortMode === "name" ? "tokens" : "name"}`}
              aria-label={`Resources: sort by ${sortMode === "name" ? "tokens" : "name"}`}
            >
              {sortMode === "tokens" ? "\u25BE tok" : "A\u2193Z"}
            </button>
          )}
        </span>
        <span
          className="text-[10px] font-mono px-1.5 py-0.5 rounded-full ml-auto pointer-events-none"
          style={
            loadedCount > 0
              ? { backgroundColor: 'rgba(196,154,42,0.2)', color: 'var(--sub-brass)' }
              : { backgroundColor: 'var(--sub-panel-light)', color: 'var(--sub-text-dim)' }
          }
        >
          {loadedCount}/{resources.length}{totalTokens > 0 ? ` (~${totalTokens.toLocaleString()} tok)` : ""}
        </span>
      </div>

      {open && (
        <div className="mt-1.5">
          <div className="flex items-center px-2 py-1 mb-0.5">
            <button
              onClick={handleToggleAll}
              disabled={toggling}
              className="text-[10px] disabled:opacity-50"
              style={{ color: 'var(--sub-brass)' }}
            >
              {toggling ? "..." : loadedCount > 0 ? "Deselect all" : "Select all"}
            </button>
          </div>
          <div className="space-y-0.5">
            {sortedResources.map(({ resource: r, tokens }) => {
              const uri = r.uri as string;
              const isLoaded = loadedUris.has(uri);
              return (
                <label
                  key={uri}
                  className="flex items-center gap-2 px-2 py-1 rounded cursor-pointer text-xs hover:bg-[var(--sub-panel-light)]"
                  style={{ color: 'var(--sub-text)' }}
                >
                  <input
                    type="checkbox"
                    checked={isLoaded}
                    onChange={() => toggleResource(uri)}
                    className="w-3 h-3 rounded cursor-pointer accent-amber-600"
                  />
                  <span className="truncate flex-1">{r.name || uri}</span>
                  <span
                    className="text-[10px] font-mono shrink-0"
                    style={{ color: 'var(--sub-text-dim)' }}
                    title={tokens === null ? "Load to count its tokens" : undefined}
                  >
                    {tokens === null ? "\u2014" : tokens.toLocaleString()}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
