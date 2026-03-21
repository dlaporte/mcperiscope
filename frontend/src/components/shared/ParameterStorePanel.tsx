import { useState } from "react";
import { useStore } from "../../store";
import type { ParamEntry } from "../../store";

function formatContext(context: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(context)) {
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      parts.push(`${k}: ${v}`);
    }
  }
  return parts.join(", ");
}

function ParamValueBadge({ entry }: { entry: ParamEntry }) {
  const tooltip = formatContext(entry.context);
  return (
    <span
      className="inline-block text-xs font-mono px-2 py-0.5 rounded cursor-default max-w-full truncate"
      style={{ backgroundColor: 'var(--sub-panel-light)', color: 'var(--sub-text)' }}
      title={tooltip}
    >
      {String(entry.value)}
    </span>
  );
}

export function ParameterStorePanel() {
  const { parameterStore, clearParamStore, parameterAliases, removeParamAlias } = useStore();
  const [open, setOpen] = useState(false);

  const entries = Object.entries(parameterStore).filter(([, v]) => v.length > 0);
  const aliasEntries = Object.entries(parameterAliases);
  const totalValues = entries.reduce((sum, [, v]) => sum + v.length, 0);
  const totalCount = entries.length + aliasEntries.length;

  if (totalCount === 0) return null;

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 bg-black/40 z-40 transition-opacity"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Tab trigger on right edge */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed right-0 top-1/2 -translate-y-1/2 z-30 border border-r-0 rounded-l-lg px-2 py-3 transition-colors group"
          style={{
            backgroundColor: 'var(--sub-panel)',
            borderColor: 'var(--sub-rivet)',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--sub-panel-light)')}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'var(--sub-panel)')}
          title="Parameter Store"
        >
          <div className="flex flex-col items-center gap-1">
            <span
              className="text-xs font-semibold [writing-mode:vertical-lr] rotate-180"
              style={{ color: 'var(--sub-text-dim)' }}
            >
              Params
            </span>
            <span
              className="text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center"
              style={{ backgroundColor: 'rgba(196,154,42,0.2)', color: 'var(--sub-brass)' }}
            >
              {totalValues}
            </span>
          </div>
        </button>
      )}

      {/* Slide-over panel */}
      <div
        className={`fixed top-0 right-0 h-full w-96 z-50 shadow-2xl transform transition-transform duration-200 ease-in-out flex flex-col ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
        style={{ backgroundColor: 'var(--sub-hull)', borderLeft: '1px solid var(--sub-rivet)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid var(--sub-rivet)' }}>
          <h3 className="text-sm font-semibold" style={{ color: 'var(--sub-text)' }}>
            Parameter Store
            <span className="ml-2 text-xs" style={{ color: 'var(--sub-text-dim)' }}>
              ({entries.length} keys, {totalValues} values)
            </span>
          </h3>
          <div className="flex items-center gap-2">
            <button
              onClick={clearParamStore}
              className="text-xs alarm-text hover:opacity-80 transition-colors"
            >
              Clear All
            </button>
            <button
              onClick={() => setOpen(false)}
              className="transition-colors text-lg leading-none"
              style={{ color: 'var(--sub-text-dim)' }}
              onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--sub-text)')}
              onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--sub-text-dim)')}
            >
              &times;
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Values */}
          {entries.length > 0 && (
            <div className="space-y-2">
              {entries.map(([key, paramEntries]) => (
                <div
                  key={key}
                  className="rounded-lg px-3 py-2 panel-riveted"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[11px] font-medium" style={{ color: 'var(--sub-text-dim)' }}>{key}</span>
                    {paramEntries.length > 1 && (
                      <span className="text-[10px]" style={{ color: 'var(--sub-text-dim)', opacity: 0.6 }}>
                        ({paramEntries.length} values)
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {paramEntries.slice(0, 10).map((entry, i) => (
                      <ParamValueBadge key={i} entry={entry} />
                    ))}
                    {paramEntries.length > 10 && (
                      <span className="text-[10px] self-center" style={{ color: 'var(--sub-text-dim)', opacity: 0.6 }}>
                        +{paramEntries.length - 10} more
                      </span>
                    )}
                  </div>
                  {paramEntries[0]?.source && (
                    <div className="text-[10px] mt-1" style={{ color: 'var(--sub-text-dim)', opacity: 0.6 }}>
                      from {paramEntries[0].source}
                      {paramEntries.length > 1 && ` + ${new Set(paramEntries.map(e => e.source)).size - 1} other source(s)`}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Aliases */}
          {aliasEntries.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--sub-text-dim)' }}>
                Mappings
              </h4>
              <div className="space-y-1.5">
                {aliasEntries.map(([fieldName, storeKey]) => (
                  <div
                    key={fieldName}
                    className="flex items-center justify-between rounded-lg px-3 py-2"
                    style={{ backgroundColor: 'rgba(53,56,57,0.3)', border: '1px solid rgba(74,78,80,0.3)' }}
                  >
                    <div className="flex items-center gap-1.5 text-xs font-mono min-w-0">
                      <span className="truncate" style={{ color: 'var(--sub-text-dim)' }}>{fieldName}</span>
                      <span className="shrink-0" style={{ color: 'var(--sub-text-dim)', opacity: 0.5 }}>&larr;</span>
                      <span className="truncate" style={{ color: 'var(--sub-brass)' }}>{storeKey}</span>
                    </div>
                    <button
                      onClick={() => removeParamAlias(fieldName)}
                      className="transition-colors text-xs ml-2 shrink-0"
                      style={{ color: 'var(--sub-text-dim)' }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--sub-red)')}
                      onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--sub-text-dim)')}
                      title="Remove mapping"
                    >
                      &times;
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
