import { useState, useMemo } from "react";
import { useStore } from "../../store";

type SortMode = "name" | "tokens";

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function estimateResourceTokens(resource: any): number {
  return estimateTokens(`${resource.name || ""}: ${resource.description || ""} (${resource.uri || ""})`);
}

export function ResourcePicker() {
  const resources = useStore((s) => s.resources);
  const loadedResources = useStore((s) => s.loadedResources);
  const toggleResource = useStore((s) => s.toggleResource);
  const [open, setOpen] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("name");

  if (resources.length === 0) return null;

  const loadedUris = new Set(loadedResources.map((r) => r.uri));
  const loadedCount = loadedResources.length;
  const totalTokens = loadedResources.reduce((sum, r) => sum + r.tokens, 0);

  const sortedResources = useMemo(() => {
    const withTokens = resources.map((r: any) => ({
      resource: r,
      tokens: loadedResources.find((lr) => lr.uri === r.uri)?.tokens ?? estimateResourceTokens(r),
    }));
    if (sortMode === "tokens") {
      return [...withTokens].sort((a, b) => b.tokens - a.tokens);
    }
    return [...withTokens].sort((a, b) => (a.resource.name || "").localeCompare(b.resource.name || ""));
  }, [resources, loadedResources, sortMode]);

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
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 text-sm font-medium w-full"
        style={{ color: 'var(--sub-text)' }}
      >
        <span>{open ? "\u25BE" : "\u25B8"}</span>
        <span className="flex items-center gap-1.5">
          Resources
          {open && (
            <span
              className="text-[10px] font-mono px-1 py-0.5 rounded cursor-pointer"
              style={{ backgroundColor: 'var(--sub-hull)', color: 'var(--sub-text-dim)' }}
              onClick={(e) => { e.stopPropagation(); setSortMode(sortMode === "name" ? "tokens" : "name"); }}
              title={`Sort by ${sortMode === "name" ? "tokens" : "name"}`}
            >
              {sortMode === "tokens" ? "\u25BE tok" : "A\u2193Z"}
            </span>
          )}
        </span>
        <span
          className="text-[10px] font-mono px-1.5 py-0.5 rounded-full ml-auto"
          style={
            loadedCount > 0
              ? { backgroundColor: 'rgba(196,154,42,0.2)', color: 'var(--sub-brass)' }
              : { backgroundColor: 'var(--sub-panel-light)', color: 'var(--sub-text-dim)' }
          }
        >
          {loadedCount}/{resources.length}{totalTokens > 0 ? ` (~${totalTokens.toLocaleString()} tok)` : ""}
        </span>
      </button>

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
            {sortedResources.map(({ resource: r, tokens }: any) => {
              const uri = r.uri as string;
              const isLoaded = loadedUris.has(uri);
              const loadedEntry = loadedResources.find((lr) => lr.uri === uri);
              const displayTokens = loadedEntry?.tokens ?? tokens;
              return (
                <label
                  key={uri}
                  className="flex items-center gap-2 px-2 py-1 rounded cursor-pointer text-xs"
                  style={{ color: 'var(--sub-text)' }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--sub-panel-light)')}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
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
                    style={{ color: isLoaded ? 'var(--sub-text-dim)' : 'var(--sub-hull)' }}
                  >
                    {displayTokens.toLocaleString()}
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
