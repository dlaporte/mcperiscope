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
      className="inline-block bg-gray-700/60 text-gray-200 text-xs font-mono px-2 py-0.5 rounded cursor-default max-w-full truncate"
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
          className="fixed right-0 top-1/2 -translate-y-1/2 z-30 bg-gray-800 border border-r-0 border-gray-600 rounded-l-lg px-2 py-3 hover:bg-gray-700 transition-colors group"
          title="Parameter Store"
        >
          <div className="flex flex-col items-center gap-1">
            <span className="text-xs font-semibold text-gray-400 group-hover:text-gray-200 [writing-mode:vertical-lr] rotate-180">
              Params
            </span>
            <span className="text-[10px] bg-blue-500/20 text-blue-400 font-bold rounded-full w-5 h-5 flex items-center justify-center">
              {totalValues}
            </span>
          </div>
        </button>
      )}

      {/* Slide-over panel */}
      <div
        className={`fixed top-0 right-0 h-full w-96 border-l border-gray-700 z-50 shadow-2xl transform transition-transform duration-200 ease-in-out flex flex-col ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
        style={{ backgroundColor: "#1a1d23" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
          <h3 className="text-sm font-semibold text-white">
            Parameter Store
            <span className="ml-2 text-xs text-gray-500">
              ({entries.length} keys, {totalValues} values)
            </span>
          </h3>
          <div className="flex items-center gap-2">
            <button
              onClick={clearParamStore}
              className="text-xs text-red-400 hover:text-red-300 transition-colors"
            >
              Clear All
            </button>
            <button
              onClick={() => setOpen(false)}
              className="text-gray-500 hover:text-gray-300 transition-colors text-lg leading-none"
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
                  className="bg-gray-800/50 rounded-lg px-3 py-2 border border-gray-700/50"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[11px] font-medium text-gray-400">{key}</span>
                    {paramEntries.length > 1 && (
                      <span className="text-[10px] text-gray-600">
                        ({paramEntries.length} values)
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {paramEntries.slice(0, 10).map((entry, i) => (
                      <ParamValueBadge key={i} entry={entry} />
                    ))}
                    {paramEntries.length > 10 && (
                      <span className="text-[10px] text-gray-600 self-center">
                        +{paramEntries.length - 10} more
                      </span>
                    )}
                  </div>
                  {paramEntries[0]?.source && (
                    <div className="text-[10px] text-gray-600 mt-1">
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
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                Mappings
              </h4>
              <div className="space-y-1.5">
                {aliasEntries.map(([fieldName, storeKey]) => (
                  <div
                    key={fieldName}
                    className="flex items-center justify-between bg-gray-800/30 rounded-lg px-3 py-2 border border-gray-700/30"
                  >
                    <div className="flex items-center gap-1.5 text-xs font-mono min-w-0">
                      <span className="text-gray-400 truncate">{fieldName}</span>
                      <span className="text-gray-600 shrink-0">&larr;</span>
                      <span className="text-blue-400 truncate">{storeKey}</span>
                    </div>
                    <button
                      onClick={() => removeParamAlias(fieldName)}
                      className="text-gray-600 hover:text-red-400 transition-colors text-xs ml-2 shrink-0"
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
