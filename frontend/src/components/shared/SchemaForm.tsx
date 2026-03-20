import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useStore } from "../../store";

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
        className="text-gray-500 hover:text-blue-400 transition-colors ml-1.5"
        title={`Map a stored parameter to "${fieldName}"`}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M7 2H4a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h3a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2Z" />
          <path d="M12 7H9a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h3a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2Z" />
          <path d="M7 7 9 9" />
        </svg>
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 bg-gray-800 border border-gray-600 rounded-lg shadow-xl min-w-[220px] max-h-48 overflow-y-auto">
          <div className="px-3 py-1.5 text-[10px] uppercase tracking-wide text-gray-500 border-b border-gray-700">
            Map store param to "{fieldName}"
          </div>
          {storeEntries.map(([storeKey, value]) => (
            <button
              key={storeKey}
              type="button"
              className="w-full text-left px-3 py-2 hover:bg-gray-700 transition-colors flex items-center gap-2"
              onClick={() => {
                onSelect(storeKey, value);
                setOpen(false);
              }}
            >
              <span className="text-xs font-mono text-blue-400 shrink-0">{storeKey}</span>
              <span className="text-[11px] text-gray-500 truncate">{String(value)}</span>
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
  const { parameterAliases, addParamAlias } = useStore();

  // Resolve values: exact match first, then alias lookup
  const seeded = useMemo(() => {
    if (!initialValues) return {};
    const out: Record<string, any> = {};
    for (const key of Object.keys(properties)) {
      // Exact match
      if (key in initialValues && initialValues[key] !== undefined && initialValues[key] !== null && initialValues[key] !== "") {
        out[key] = initialValues[key];
        continue;
      }
      // Alias match
      const aliasKey = parameterAliases[key];
      if (aliasKey && aliasKey in initialValues && initialValues[aliasKey] !== undefined && initialValues[aliasKey] !== null && initialValues[aliasKey] !== "") {
        out[key] = initialValues[aliasKey];
      }
    }
    return out;
  }, [initialValues, properties, parameterAliases]);

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
    // Field already has an exact match or is already filled — no need to show
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
        <p className="text-gray-400 text-sm mb-3">No parameters required.</p>
        <button
          type="submit"
          disabled={loading}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium"
        >
          {loading ? "Loading..." : submitLabel}
        </button>
      </form>
    );
  }

  const autoClass = "border-blue-500/50";
  const normalClass = "border-gray-600";

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {Object.entries(properties).map(([key, prop]: [string, any]) => {
        const unmatchedEntries = getUnmatchedStoreEntries(key);
        const hasAlias = key in parameterAliases;

        return (
          <div key={key}>
            <label className="flex items-center text-sm font-medium text-gray-300 mb-1">
              {key}
              {required.has(key) && <span className="text-red-400 ml-1">*</span>}
              {isAutoFilled(key) && (
                <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded">
                  auto{hasAlias ? ` (${parameterAliases[key]})` : ""}
                </span>
              )}
              {unmatchedEntries.length > 0 && (
                <LinkDropdown
                  fieldName={key}
                  storeEntries={unmatchedEntries}
                  onSelect={(storeKey, value) => handleMapParam(key, storeKey, value)}
                />
              )}
              {prop.description && (
                <span className="text-gray-500 font-normal ml-2">
                  {prop.description}
                </span>
              )}
            </label>
            {prop.type === "boolean" ? (
              <select
                value={String(values[key] ?? "")}
                onChange={(e) => handleChange(key, e.target.value)}
                className={`w-full bg-gray-800 border ${isAutoFilled(key) ? autoClass : normalClass} rounded-lg px-3 py-2 text-sm text-white`}
              >
                <option value="">--</option>
                <option value="true">true</option>
                <option value="false">false</option>
              </select>
            ) : prop.enum ? (
              <select
                value={String(values[key] ?? "")}
                onChange={(e) => handleChange(key, e.target.value)}
                className={`w-full bg-gray-800 border ${isAutoFilled(key) ? autoClass : normalClass} rounded-lg px-3 py-2 text-sm text-white`}
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
                className={`w-full bg-gray-800 border ${isAutoFilled(key) ? autoClass : normalClass} rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500`}
              />
            )}
          </div>
        );
      })}
      <button
        type="submit"
        disabled={loading}
        className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium"
      >
        {loading ? "Loading..." : submitLabel}
      </button>
    </form>
  );
}
