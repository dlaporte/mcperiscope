import { useState, useRef, useEffect, useCallback } from "react";
import { useStore } from "../../store";
import { AuthConfig } from "./AuthConfig";
import { ModelConfig } from "./ModelConfig";

const STORAGE_KEY = "mcperiscope:url-history";
const AUTH_CACHE_KEY = "mcperiscope:auth-cache";
const MAX_HISTORY = 20;

interface CachedAuth {
  method: string;
  token?: string;
  headerName?: string;
  headerValue?: string;
}

function loadHistory(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.filter((s) => typeof s === "string");
    }
  } catch { /* ignore */ }
  return [];
}

function saveHistory(urls: string[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(urls.slice(0, MAX_HISTORY)));
}

function addToHistory(url: string) {
  const history = loadHistory().filter((u) => u !== url);
  history.unshift(url);
  saveHistory(history);
}

function removeFromHistory(url: string) {
  saveHistory(loadHistory().filter((u) => u !== url));
  const cache = loadAuthCache();
  delete cache[url];
  saveAuthCache(cache);
}

function loadAuthCache(): Record<string, CachedAuth> {
  try {
    const raw = localStorage.getItem(AUTH_CACHE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return {};
}

function saveAuthCache(cache: Record<string, CachedAuth>) {
  localStorage.setItem(AUTH_CACHE_KEY, JSON.stringify(cache));
}

function cacheAuthForUrl(url: string, auth: CachedAuth) {
  const cache = loadAuthCache();
  cache[url] = auth;
  saveAuthCache(cache);
}

function getCachedAuth(url: string): CachedAuth | undefined {
  return loadAuthCache()[url];
}

export function ConnectTab() {
  const {
    connected, connecting, error, connect, disconnect, serverInfo, oauthPending,
    connectProgress,
    authMethod, authToken, headerName, headerValue,
    setAuthMethod, setAuthToken, setHeaderName, setHeaderValue,
    checkStatus,
  } = useStore();

  const [url, setUrl] = useState(() => {
    // Restore URL from server info if already connected, or from most recent history
    if (serverInfo && typeof serverInfo === "object" && "url" in serverInfo) {
      return (serverInfo as { url: string }).url;
    }
    const history = loadHistory();
    return history.length > 0 ? history[0] : "";
  });
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [historyVersion, setHistoryVersion] = useState(0);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { completeOAuth } = useStore();

  // Check backend status on mount, and resume pending OAuth if needed
  useEffect(() => {
    checkStatus();

    const pendingCallback = localStorage.getItem("mcperiscope:pending-oauth-callback");
    if (pendingCallback) {
      localStorage.removeItem("mcperiscope:pending-oauth-callback");
      completeOAuth(pendingCallback);
    }
  }, [checkStatus, completeOAuth]);

  const history = loadHistory();
  // Force re-read when historyVersion changes
  void historyVersion;

  const matches = url.trim()
    ? history.filter((u) => u.toLowerCase().includes(url.toLowerCase()))
    : history;

  const isOpen = showDropdown && matches.length > 0 && !connected && !connecting;

  // Save to history only after successful connection
  useEffect(() => {
    if (connected && url.trim()) {
      addToHistory(url.trim());
      cacheAuthForUrl(url.trim(), {
        method: authMethod,
        token: authToken || undefined,
        headerName: headerName || undefined,
        headerValue: headerValue || undefined,
      });
      setHistoryVersion((v) => v + 1);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

  const handleConnect = (e: React.FormEvent) => {
    e.preventDefault();
    if (url.trim()) {
      setShowDropdown(false);
      connect(url.trim());
    }
  };

  const restoreAuthForUrl = (targetUrl: string) => {
    const cached = getCachedAuth(targetUrl);
    if (cached) {
      setAuthMethod(cached.method as "none" | "bearer" | "header" | "oauth");
      setAuthToken(cached.token ?? "");
      setHeaderName(cached.headerName ?? "");
      setHeaderValue(cached.headerValue ?? "");
    } else {
      setAuthMethod("none");
      setAuthToken("");
      setHeaderName("");
      setHeaderValue("");
    }
  };

  const selectUrl = (selected: string) => {
    setUrl(selected);
    restoreAuthForUrl(selected);
    setShowDropdown(false);
    setSelectedIndex(-1);
    inputRef.current?.focus();
  };

  const handleRemove = (e: React.MouseEvent, urlToRemove: string) => {
    e.stopPropagation();
    removeFromHistory(urlToRemove);
    setHistoryVersion((v) => v + 1);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, matches.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, -1));
    } else if (e.key === "Enter" && selectedIndex >= 0) {
      e.preventDefault();
      selectUrl(matches[selectedIndex]);
    } else if (e.key === "Escape") {
      setShowDropdown(false);
    }
  };

  const handleClickOutside = useCallback((e: MouseEvent) => {
    if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
      setShowDropdown(false);
    }
  }, []);

  useEffect(() => {
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [handleClickOutside]);

  const highlightMatch = (fullUrl: string, query: string) => {
    if (!query.trim()) return <>{fullUrl}</>;
    const idx = fullUrl.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return <>{fullUrl}</>;
    return (
      <>
        {fullUrl.slice(0, idx)}
        <span className="text-white font-semibold">{fullUrl.slice(idx, idx + query.length)}</span>
        {fullUrl.slice(idx + query.length)}
      </>
    );
  };

  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="w-full max-w-xl">
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6 shadow-lg">
          <div className="flex items-center gap-3 mb-6">
            <div
              className={`w-3 h-3 rounded-full ${
                connected ? "bg-green-500" : "bg-gray-500"
              }`}
            />
            <h2 className="text-lg font-semibold text-white">
              {connected ? "Connected" : "Connect to MCP Server"}
            </h2>
          </div>

          <form onSubmit={handleConnect} className="space-y-4">
            {/* URL Input */}
            <div ref={wrapperRef} className="relative">
              <label className="block text-sm text-gray-400 mb-1">Server URL</label>
              <input
                ref={inputRef}
                type="text"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  setShowDropdown(true);
                  setSelectedIndex(-1);
                }}
                onFocus={() => setShowDropdown(true)}
                onKeyDown={handleKeyDown}
                placeholder="e.g. http://localhost:3000/sse"
                disabled={connected || connecting}
                className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 disabled:opacity-50"
              />
              {isOpen && (
                <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-gray-900 border border-gray-600 rounded-lg shadow-xl overflow-hidden max-h-60 overflow-y-auto">
                  {matches.map((item, i) => {
                    const cached = getCachedAuth(item);
                    const authLabel = cached?.method && cached.method !== "none" ? cached.method : null;
                    return (
                      <div
                        key={item}
                        onMouseDown={() => selectUrl(item)}
                        onMouseEnter={() => setSelectedIndex(i)}
                        className={`flex items-center justify-between px-3 py-2 text-sm font-mono cursor-pointer group ${
                          i === selectedIndex
                            ? "bg-gray-700 text-white"
                            : "text-gray-400 hover:bg-gray-800"
                        }`}
                      >
                        <span className="truncate">{highlightMatch(item, url)}</span>
                        <div className="flex items-center gap-1.5 shrink-0 ml-2">
                          {authLabel && (
                            <span className="text-[10px] bg-gray-700 text-gray-400 px-1.5 py-0.5 rounded">
                              {authLabel}
                            </span>
                          )}
                          <button
                            type="button"
                            onMouseDown={(e) => handleRemove(e, item)}
                            className="text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity text-xs"
                            title="Remove from history"
                          >
                            x
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Auth Config */}
            <div>
              <label className="block text-sm text-gray-400 mb-1">Authentication</label>
              <AuthConfig />
            </div>

            {/* Model Config */}
            <div>
              <label className="block text-sm text-gray-400 mb-1">LLM Configuration</label>
              <ModelConfig />
            </div>

            {/* Connect / Disconnect Button */}
            <div className="pt-2">
              {connected ? (
                <button
                  type="button"
                  onClick={disconnect}
                  className="w-full bg-red-600 hover:bg-red-700 text-white px-4 py-2.5 rounded-lg text-sm font-medium"
                >
                  Disconnect
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={connecting || !url.trim()}
                  className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2.5 rounded-lg text-sm font-medium"
                >
                  {connecting ? "Connecting..." : oauthPending ? "Redirecting..." : "Connect"}
                </button>
              )}
            </div>
          </form>

          {/* Error Display */}
          {error && (
            <p className="text-red-400 text-sm mt-4">{error}</p>
          )}

          {/* Connection Progress */}
          {connecting && connectProgress && (
            <div className="mt-4 p-3 bg-gray-900 rounded-lg flex items-center gap-3">
              <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
              <span className="text-sm text-gray-400">{connectProgress}</span>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
