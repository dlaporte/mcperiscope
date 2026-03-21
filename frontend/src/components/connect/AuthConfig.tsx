import { useStore } from "../../store";

export function AuthConfig() {
  const {
    authMethod,
    authToken,
    headerName,
    headerValue,
    connected,
    connecting,
    setAuthMethod,
    setAuthToken,
    setHeaderName,
    setHeaderValue,
  } = useStore();

  const disabled = connected || connecting;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <select
        value={authMethod}
        onChange={(e) => setAuthMethod(e.target.value as "none" | "bearer" | "header" | "oauth")}
        disabled={disabled}
        className="input-sub border rounded-lg px-2 py-2 text-sm disabled:opacity-50"
      >
        <option value="none">No Auth</option>
        <option value="bearer">Bearer Token</option>
        <option value="header">Custom Header</option>
        <option value="oauth">OAuth 2.0</option>
      </select>

      {authMethod === "bearer" && (
        <input
          type="password"
          value={authToken}
          onChange={(e) => setAuthToken(e.target.value)}
          placeholder="Token"
          disabled={disabled}
          className="input-sub border rounded-lg px-3 py-2 text-sm  disabled:opacity-50 min-w-[200px]"
        />
      )}

      {authMethod === "header" && (
        <>
          <input
            type="text"
            value={headerName}
            onChange={(e) => setHeaderName(e.target.value)}
            placeholder="Header name"
            disabled={disabled}
            className="input-sub border rounded-lg px-3 py-2 text-sm  disabled:opacity-50 w-[140px]"
          />
          <input
            type="password"
            value={headerValue}
            onChange={(e) => setHeaderValue(e.target.value)}
            placeholder="Header value"
            disabled={disabled}
            className="input-sub border rounded-lg px-3 py-2 text-sm  disabled:opacity-50 min-w-[200px]"
          />
        </>
      )}

      {authMethod === "oauth" && !connected && (
        <span className="text-xs" style={{ color: 'var(--sub-text-dim)' }}>
          Click Connect to start OAuth flow
        </span>
      )}
    </div>
  );
}
