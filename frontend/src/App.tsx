import { useStore } from "./store";
import { TabBar } from "./components/layout/TabBar";
import { ConnectTab } from "./components/connect/ConnectTab";
import { ExploreTab } from "./components/explore/ExploreTab";
import { OptimizeTab } from "./components/optimize/OptimizeTab";
import { ResultsTab } from "./components/results/ResultsTab";
import { OAuthCallback } from "./components/shared/OAuthCallback";

function App() {
  const activeTab = useStore((s) => s.activeTab);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const connected = useStore((s) => s.connected);

  // Handle OAuth callback route
  if (window.location.pathname === "/oauth/callback") {
    return <OAuthCallback />;
  }

  return (
    <div className="h-screen flex flex-col bg-gray-900 text-white">
      <TabBar active={activeTab} onChange={setActiveTab} connected={connected} />
      <div className="flex-1 overflow-hidden">
        {activeTab === "connect" && <ConnectTab />}
        {activeTab === "explore" && connected && <ExploreTab />}
        {activeTab === "optimize" && connected && <OptimizeTab />}
        {activeTab === "results" && connected && <ResultsTab />}
        {!connected && activeTab !== "connect" && (
          <div className="flex items-center justify-center h-full text-gray-500">
            Connect to an MCP server first
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
