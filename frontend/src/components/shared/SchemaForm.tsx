import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useStore } from "../../store";
import type { ParamEntry } from "../../store";

interface JsonSchema {
  type?: string;
  properties?: Record<string, any>;
  required?: string[];
}

interface Props {
  schema: JsonSchema;
  onSubmit: (values: Record<string, any>) => void;
  submitLabel: string;
  loading?: boolean;
  initialValues?: Record<string, unknown>;
}

function formatContextHint(entry: ParamEntry): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(entry.context)) {
    if (String(v) !== String(entry.value) && (typeof v === "string" || typeof v === "number")) {
      parts.push(`${k}: ${v}`);
    }
  }
  if (parts.length === 0) return String(entry.value);
  return parts.join(", ");
}

function ValuePicker({
  fieldKey,
  entries,
  currentValue,
  onSelect,
}: {
  fieldKey: string;
  entries: ParamEntry[];
  currentValue: unknown;
  onSelect: (value: string | number | boolean) => void;
}) {
  // Use a key-scoped ID to keep dropdown state stable across re-renders
  const [openField, setOpenField] = useState<string | null>(null);
  const open = openField === fieldKey;
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      // Delay check so the button click can process first
      setTimeout(() => {
        if (ref.current && !ref.current.contains(e.target as Node)) {
          setOpenField(null);
        }
      }, 0);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const sortedEntries = useMemo(
    () => [...entries].sort((a, b) => String(a.value).localeCompare(String(b.value))),
    [entries]
  );

  if (sortedEntries.length <= 1) return null;

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => setOpenField(open ? null : fieldKey)}
        className="text-[10px] ml-1.5 tabular-nums"
        style={{ color: 'var(--sub-brass)' }}
        onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--sub-brass-glow)')}
        onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--sub-brass)')}
        title="Pick from stored values"
      >
        {sortedEntries.length} values
      </button>
      {open && (
        <div
          className="absolute left-0 top-full mt-1 z-50 rounded-lg shadow-xl min-w-[300px] max-h-60 overflow-y-auto"
          style={{ backgroundColor: 'var(--sub-panel)', border: '1px solid var(--sub-rivet)' }}
        >
          <div
            className="px-3 py-1.5 text-[10px] uppercase tracking-wide"
            style={{ color: 'var(--sub-text-dim)', borderBottom: '1px solid var(--sub-rivet)' }}
          >
            Select a value
          </div>
          {sortedEntries.map((entry, i) => {
            const isSelected = String(entry.value) === String(currentValue);
            const hint = formatContextHint(entry);
            return (
              <button
                key={i}
                type="button"
                className="w-full text-left px-3 py-2 transition-colors last:border-b-0"
                style={{
                  backgroundColor: isSelected ? 'rgba(196,154,42,0.15)' : 'transparent',
                  borderBottom: '1px solid rgba(74,78,80,0.5)',
                }}
                onMouseDown={(e) => e.stopPropagation()}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--sub-panel-light)')}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = isSelected ? 'rgba(196,154,42,0.15)' : 'transparent')}
                onClick={() => {
                  onSelect(entry.value);
                  setOpenField(null);
                }}
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono shrink-0" style={{ color: 'var(--sub-text)' }}>
                    {String(entry.value).length > 40
                      ? String(entry.value).slice(0, 40) + "..."
                      : String(entry.value)}
                  </span>
                  {isSelected && (
                    <span className="text-[10px]" style={{ color: 'var(--sub-brass)' }}>current</span>
                  )}
                </div>
                <div className="text-[10px] mt-0.5 truncate" style={{ color: 'var(--sub-text-dim)' }}>
                  {hint}
                </div>
                <div className="text-[10px] mt-0.5" style={{ color: 'var(--sub-text-dim)', opacity: 0.6 }}>
                  from {entry.source}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function LinkDropdown({
  fieldName,
  storeEntries,
  onSelect,
}: {
  fieldName: string;
  storeEntries: [string, unknown][];
  onSelect: (storeKey: string, value: unknown) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const handleClickOutside = useCallback((e: MouseEvent) => {
    if (ref.current && !ref.current.contains(e.target as Node)) {
      setOpen(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [open, handleClickOutside]);

  if (storeEntries.length === 0) return null;

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="transition-colors ml-1.5"
        style={{ color: 'var(--sub-text-dim)' }}
        onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--sub-brass)')}
        onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--sub-text-dim)')}
        title={`Map a stored parameter to "${fieldName}"`}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M7 2H4a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h3a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2Z" />
          <path d="M12 7H9a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h3a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2Z" />
          <path d="M7 7 9 9" />
        </svg>
      </button>
      {open && (
        <div
          className="absolute left-0 top-full mt-1 z-50 rounded-lg shadow-xl min-w-[220px] max-h-48 overflow-y-auto"
          style={{ backgroundColor: 'var(--sub-panel)', border: '1px solid var(--sub-rivet)' }}
        >
          <div
            className="px-3 py-1.5 text-[10px] uppercase tracking-wide"
            style={{ color: 'var(--sub-text-dim)', borderBottom: '1px solid var(--sub-rivet)' }}
          >
            Map store param to &quot;{fieldName}&quot;
          </div>
          {storeEntries.map(([storeKey, value]) => (
            <button
              key={storeKey}
              type="button"
              className="w-full text-left px-3 py-2 transition-colors flex items-center gap-2"
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--sub-panel-light)')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
              onClick={() => {
                onSelect(storeKey, value);
                setOpen(false);
              }}
            >
              <span className="text-xs font-mono shrink-0" style={{ color: 'var(--sub-brass)' }}>{storeKey}</span>
              <span className="text-[11px] truncate" style={{ color: 'var(--sub-text-dim)' }}>{String(value)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function SchemaForm({ schema, onSubmit, submitLabel, loading, initialValues }: Props) {
  const properties = schema.properties || {};
  const required = new Set(schema.required || []);
  const { parameterStore, parameterAliases, removedAliases, addParamAlias } = useStore();

  // Convert between naming conventions
  function toCamelCase(s: string): string {
    return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
  }
  function toSnakeCase(s: string): string {
    return s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
  }

  // Resolve the store key for each field -- pick the key with the most entries
  function resolveStoreKey(fieldKey: string): string | null {
    const candidates: [string, number][] = [];

    const check = (k: string) => {
      if (k in parameterStore && parameterStore[k]?.length > 0) {
        candidates.push([k, parameterStore[k].length]);
      }
    };

    // Exact match
    check(fieldKey);
    // Alias
    const aliasKey = parameterAliases[fieldKey];
    if (aliasKey) check(aliasKey);
    // camelCase <-> snake_case
    const camel = toCamelCase(fieldKey);
    if (camel !== fieldKey) check(camel);
    const snake = toSnakeCase(fieldKey);
    if (snake !== fieldKey) check(snake);

    if (candidates.length === 0) return null;
    // Return the key with the most entries
    candidates.sort((a, b) => b[1] - a[1]);
    return candidates[0][0];
  }

  // Resolve values: exact match, alias, or case variation
  // Computes seeded values and tracks which aliases need to be created
  const { seeded, aliasesToCreate } = useMemo(() => {
    if (!initialValues) return { seeded: {}, aliasesToCreate: [] as [string, string][] };
    const out: Record<string, any> = {};
    const newAliases: [string, string][] = [];
    const tryValue = (k: string) => {
      const v = initialValues[k];
      return v !== undefined && v !== null && v !== "" ? v : undefined;
    };
    for (const key of Object.keys(properties)) {
      const exact = tryValue(key);
      if (exact !== undefined) { out[key] = exact; continue; }
      // Alias
      const aliasKey = parameterAliases[key];
      if (aliasKey) {
        const aliased = tryValue(aliasKey);
        if (aliased !== undefined) { out[key] = aliased; continue; }
      }
      // Case variations -- track alias if not explicitly removed
      if (!removedAliases.has(key)) {
        const camel = toCamelCase(key);
        if (camel !== key) {
          const v = tryValue(camel);
          if (v !== undefined) {
            if (!(key in parameterAliases)) {
              newAliases.push([key, camel]);
            }
            out[key] = v;
            continue;
          }
        }
        const snake = toSnakeCase(key);
        if (snake !== key) {
          const v = tryValue(snake);
          if (v !== undefined) {
            if (!(key in parameterAliases)) {
              newAliases.push([key, snake]);
            }
            out[key] = v;
            continue;
          }
        }
      }
    }
    return { seeded: out, aliasesToCreate: newAliases };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialValues, properties, parameterAliases, removedAliases]);

  // Auto-create aliases for case-variation matches (side effect)
  useEffect(() => {
    for (const [key, target] of aliasesToCreate) {
      addParamAlias(key, target);
    }
  }, [aliasesToCreate, addParamAlias]);

  const autoFilledKeys = useMemo(() => new Set(Object.keys(seeded)), [seeded]);

  const [values, setValues] = useState<Record<string, any>>(seeded);
  const [editedKeys, setEditedKeys] = useState<Set<string>>(new Set());

  const isAutoFilled = (key: string) => autoFilledKeys.has(key) && !editedKeys.has(key);

  const handleChange = (key: string, value: any) => {
    setValues({ ...values, [key]: value });
    setEditedKeys((prev) => new Set(prev).add(key));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned: Record<string, any> = {};
    // Validate required fields
    const missingRequired = [...required].filter(key => {
      const v = values[key];
      return v === "" || v === undefined || v === null;
    });
    if (missingRequired.length > 0) {
      alert(`Required fields are missing: ${missingRequired.join(", ")}`);
      return;
    }
    for (const [k, v] of Object.entries(values)) {
      if (v !== "" && v !== undefined) {
        const prop = properties[k];
        if (prop?.type === "number" || prop?.type === "integer") {
          cleaned[k] = Number(v);
        } else if (prop?.type === "boolean") {
          cleaned[k] = v === "true" || v === true;
        } else {
          cleaned[k] = v;
        }
      }
    }
    onSubmit(cleaned);
  };

  // For the link dropdown: store entries that didn't exact-match this field
  const getUnmatchedStoreEntries = (fieldKey: string): [string, unknown][] => {
    if (!initialValues) return [];
    if (fieldKey in initialValues) return [];
    if (values[fieldKey] !== undefined && values[fieldKey] !== "") return [];
    return Object.entries(initialValues).filter(
      ([, v]) => v !== undefined && v !== null && v !== ""
    );
  };

  const handleMapParam = (fieldName: string, storeKey: string, value: unknown) => {
    addParamAlias(fieldName, storeKey);
    handleChange(fieldName, value);
  };

  if (Object.keys(properties).length === 0) {
    return (
      <form onSubmit={handleSubmit}>
        <p className="text-sm mb-3" style={{ color: 'var(--sub-text-dim)' }}>No parameters required.</p>
        <button
          type="submit"
          disabled={loading}
          className="btn-brass disabled:opacity-50 px-4 py-2 rounded-lg text-sm font-medium"
        >
          {loading ? "Loading..." : submitLabel}
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {Object.entries(properties).map(([key, prop]: [string, any]) => {
        const unmatchedEntries = getUnmatchedStoreEntries(key);
        const hasAlias = key in parameterAliases;
        const storeKey = resolveStoreKey(key);
        const multiEntries = storeKey ? (parameterStore[storeKey] ?? []) : [];

        return (
          <div key={key}>
            <label className="flex items-center flex-wrap text-sm font-medium mb-1" style={{ color: 'var(--sub-text)' }}>
              {key}
              {required.has(key) && <span className="ml-1" style={{ color: 'var(--sub-red)' }}>*</span>}
              {isAutoFilled(key) && (
                <span
                  className="ml-2 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded"
                  style={{ backgroundColor: 'rgba(196,154,42,0.2)', color: 'var(--sub-brass)' }}
                >
                  auto{hasAlias ? ` (${parameterAliases[key]})` : ""}
                </span>
              )}
              {multiEntries.length > 1 && (
                <ValuePicker
                  fieldKey={key}
                  entries={multiEntries}
                  currentValue={values[key]}
                  onSelect={(v) => handleChange(key, v)}
                />
              )}
              {unmatchedEntries.length > 0 && (
                <LinkDropdown
                  fieldName={key}
                  storeEntries={unmatchedEntries}
                  onSelect={(sk, value) => handleMapParam(key, sk, value)}
                />
              )}
              {prop.description && (
                <span className="font-normal ml-2" style={{ color: 'var(--sub-text-dim)' }}>
                  {prop.description}
                </span>
              )}
            </label>
            {prop.type === "boolean" ? (
              <select
                value={String(values[key] ?? "")}
                onChange={(e) => handleChange(key, e.target.value)}
                className="w-full input-sub border rounded-lg px-3 py-2 text-sm"
                style={isAutoFilled(key) ? { borderColor: 'var(--sub-brass-dim)' } : {}}
              >
                <option value="">--</option>
                <option value="true">true</option>
                <option value="false">false</option>
              </select>
            ) : prop.enum ? (
              <select
                value={String(values[key] ?? "")}
                onChange={(e) => handleChange(key, e.target.value)}
                className="w-full input-sub border rounded-lg px-3 py-2 text-sm"
                style={isAutoFilled(key) ? { borderColor: 'var(--sub-brass-dim)' } : {}}
              >
                <option value="">--</option>
                {prop.enum.map((v: string) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type={
                  prop.type === "number" || prop.type === "integer"
                    ? "number"
                    : "text"
                }
                value={values[key] ?? ""}
                onChange={(e) => handleChange(key, e.target.value)}
                placeholder={prop.default !== undefined ? String(prop.default) : ""}
                className="w-full input-sub border rounded-lg px-3 py-2 text-sm"
                style={isAutoFilled(key) ? { borderColor: 'var(--sub-brass-dim)' } : {}}
              />
            )}
          </div>
        );
      })}
      <button
        type="submit"
        disabled={loading}
        className="btn-brass disabled:opacity-50 px-4 py-2 rounded-lg text-sm font-medium"
      >
        {loading ? "Loading..." : submitLabel}
      </button>
    </form>
  );
}
