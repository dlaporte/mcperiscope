import { useEffect } from "react";
import { useStore } from "../../store";
import { JsonViewer } from "../shared/JsonViewer";

export function ResourceDetail() {
  const { selection, readResource, result, resultLoading, harvestResultParams } = useStore();
  const resource = selection?.item;

  useEffect(() => {
    if (result) harvestResultParams(result);
  }, [result, harvestResultParams]);

  if (!resource) return null;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-white">
          {resource.name || resource.uri}
        </h2>
        {resource.description && (
          <p className="text-gray-400 text-sm mt-1">{resource.description}</p>
        )}
        <p className="text-gray-500 text-xs mt-1 font-mono">{resource.uri}</p>
      </div>

      <button
        onClick={() => readResource(resource.uri)}
        disabled={resultLoading}
        className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium"
      >
        {resultLoading ? "Reading..." : "Read Resource"}
      </button>

      {result && (
        <div>
          <h3 className="text-sm font-semibold text-gray-300 mb-2">Content</h3>
          <JsonViewer data={result} />
        </div>
      )}
    </div>
  );
}
