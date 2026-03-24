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

  handleReset = () => {
    const LS_PREFIX = "mcperiscope:";
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(LS_PREFIX)) keys.push(key);
    }
    keys.forEach((k) => localStorage.removeItem(k));
    this.setState({ error: null });
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
            <button
              onClick={this.handleReset}
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
              Clear Settings & Reload
            </button>
            <p style={{ color: "#666", marginTop: "1rem", fontSize: "0.75rem" }}>
              This will reset your LLM and MCP server configurations.
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
