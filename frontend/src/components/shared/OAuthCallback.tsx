import { useEffect, useState } from "react";

const PENDING_KEY = "mcperiscope:pending-oauth-callback";

export function OAuthCallback() {
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const errorParam = params.get("error");

    if (errorParam) {
      setLocalError(`OAuth error: ${errorParam}`);
      return;
    }

    if (!code) {
      setLocalError("No authorization code received");
      return;
    }

    // Stash the full callback URL and redirect to Connect tab.
    // The Connect tab will pick it up and run completeOAuth with progress.
    localStorage.setItem(PENDING_KEY, window.location.href);
    window.location.replace("/");
  }, []);

  if (localError) {
    return (
      <div className="h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--sub-hull)', color: 'var(--sub-text)' }}>
        <div className="text-center">
          <p className="alarm-text text-lg mb-4">{localError}</p>
          <a
            href="/"
            className="underline"
            style={{ color: 'var(--sub-brass)' }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--sub-brass-glow)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--sub-brass)')}
          >
            Return to MCPeriscope
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--sub-hull)', color: 'var(--sub-text)' }}>
      <div className="text-center">
        <div
          className="w-8 h-8 border-2 rounded-full animate-spin mx-auto mb-4"
          style={{ borderColor: 'var(--sub-brass)', borderTopColor: 'transparent' }}
        />
        <p style={{ color: 'var(--sub-text-dim)' }}>Redirecting...</p>
      </div>
    </div>
  );
}
