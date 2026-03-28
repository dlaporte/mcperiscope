import { useEffect } from "react";
import { useStore } from "../../store";
import { JsonViewer } from "../shared/JsonViewer";

export function ResourceDetail() {
  const { selection, readResource, result, resultLoading, harvestResultParams } = useStore();
  const resource = selection?.item;

  useEffect(() => {
    if (result) harvestResultParams(result);
  }, [result, harvestResultParams]);

  if (!resource) return (
  <div className="flex items-center justify-center h-full" style={{ color: 'var(--sub-text-dim)' }}>
    <p className="text-sm">Select a resource from the sidebar to view details.</p>
  </div>
);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold font-stencil" style={{ color: 'var(--sub-text)' }}>
          {resource.name || resource.uri}
        </h2>
        {resource.description && (
          <p className="text-sm mt-1" style={{ color: 'var(--sub-text-dim)' }}>{resource.description}</p>
        )}
        <p className="text-xs mt-1 font-mono" style={{ color: 'var(--sub-text-dim)' }}>{resource.uri}</p>
      </div>

      <button
        onClick={() => readResource(resource.uri)}
        disabled={resultLoading}
        className="btn-brass disabled:opacity-50 px-4 py-2 rounded-lg text-sm font-medium"
      >
        {resultLoading ? "Reading..." : "Read Resource"}
      </button>

      {result && (
        <div>
          <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--sub-text)' }}>Content</h3>
          <JsonViewer data={result} />
        </div>
      )}
    </div>
  );
}
