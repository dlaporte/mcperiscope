import { StrictMode, Component } from 'react'
import type { ReactNode, ErrorInfo } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("MCPeriscope crashed:", error, info);
  }

  handleRetry = () => {
    this.setState({ error: null });
  };

  handleClearSession = () => {
    // Only clear ephemeral session data, preserve user configurations
    const PRESERVE_KEYS = [
      "mcperiscope:llmConfigs",
      "mcperiscope:primaryLLM",
      "mcperiscope:analystLLM",
      "mcperiscope:mcpConfigs",
      "mcperiscope:maxToolRounds",
      "mcperiscope:maxTokensPerResponse",
    ];
    const LS_PREFIX = "mcperiscope:";
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(LS_PREFIX) && !PRESERVE_KEYS.includes(key)) keys.push(key);
    }
    keys.forEach((k) => localStorage.removeItem(k));
    window.location.reload();
  };

  render() {
    if (this.state.error) {
      return (
        <div style={{
          height: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#2a2d2e",
          color: "#e0e0e0",
          fontFamily: "monospace",
        }}>
          <div style={{ textAlign: "center", maxWidth: 500 }}>
            <h1 style={{ color: "#cc3333", fontSize: "1.5rem", marginBottom: "1rem" }}>MCPeriscope Error</h1>
            <p style={{ color: "#999", marginBottom: "1rem", fontSize: "0.875rem" }}>
              {this.state.error.message}
            </p>
            <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center" }}>
              <button
                onClick={this.handleRetry}
                style={{
                  padding: "0.5rem 1.5rem",
                  backgroundColor: "#c49a2a",
                  color: "#1a1a1a",
                  border: "none",
                  borderRadius: "0.5rem",
                  cursor: "pointer",
                  fontWeight: "bold",
                  fontSize: "0.875rem",
                }}
              >
                Retry
              </button>
              <button
                onClick={this.handleClearSession}
                style={{
                  padding: "0.5rem 1.5rem",
                  backgroundColor: "transparent",
                  color: "#999",
                  border: "1px solid #555",
                  borderRadius: "0.5rem",
                  cursor: "pointer",
                  fontSize: "0.875rem",
                }}
              >
                Clear Session Data
              </button>
            </div>
            <p style={{ color: "#666", marginTop: "1rem", fontSize: "0.75rem" }}>
              Retry first. Clear Session resets ephemeral data but preserves your LLM and MCP server configurations.
            </p>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
