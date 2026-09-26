import { useEffect, useState } from "react";
import { PENDING_OAUTH_KEY } from "../../store";

function callbackError(): string | null {
  const params = new URLSearchParams(window.location.search);
  const errorParam = params.get("error");
  if (errorParam) return `OAuth error: ${errorParam}`;
  if (!params.get("code")) return "No authorization code received";
  return null;
}

export function OAuthCallback() {
  // The callback URL is fixed for this page, so its error can be read once up front
  const [localError] = useState(callbackError);

  useEffect(() => {
    if (localError) return;
    // Stash the full callback URL and redirect to Connect tab.
    // The Connect tab will pick it up and run completeOAuth with progress.
    sessionStorage.setItem(PENDING_OAUTH_KEY, window.location.href);
    window.location.replace("/");
  }, [localError]);

  if (localError) {
    return (
      <div className="h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--sub-hull)', color: 'var(--sub-text)' }}>
        <div className="text-center">
          <p className="alarm-text text-lg mb-4">{localError}</p>
          <a
            href="/"
            className="underline text-[var(--sub-brass)] hover:text-[var(--sub-brass-glow)]"
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
