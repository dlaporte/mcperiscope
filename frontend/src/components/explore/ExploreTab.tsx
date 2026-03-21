import { useStore } from "../../store";
import { Sidebar } from "./Sidebar";
import { ToolDetail } from "./ToolDetail";
import { ResourceDetail } from "./ResourceDetail";
import { PromptDetail } from "./PromptDetail";
import { InventoryBar } from "./InventoryBar";
import { ParameterStorePanel } from "../shared/ParameterStorePanel";

function DetailPanel() {
  const { selection, connected } = useStore();

  if (!connected) {
    return (
      <div className="flex-1 flex items-center justify-center" style={{ color: 'var(--sub-text-dim)' }}>
        <div className="text-center">
          <p className="text-2xl mb-2">MCP Periscope</p>
          <p className="text-sm">
            Connect to an MCP server to explore its capabilities.
          </p>
        </div>
      </div>
    );
  }

  if (!selection) {
    return (
      <div className="flex-1 flex items-center justify-center" style={{ color: 'var(--sub-text-dim)' }}>
        <p className="text-sm">Select a tool, resource, or prompt from the sidebar.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      {selection.type === "tool" && <ToolDetail />}
      {selection.type === "resource" && <ResourceDetail />}
      {selection.type === "prompt" && <PromptDetail />}
    </div>
  );
}

export function ExploreTab() {
  return (
    <div className="flex flex-col h-full">
      <InventoryBar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <DetailPanel />
      </div>
      <ParameterStorePanel />
    </div>
  );
}
