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
      <div className="h-screen flex items-center justify-center bg-gray-900 text-white">
        <div className="text-center">
          <p className="text-red-400 text-lg mb-4">{localError}</p>
          <a href="/" className="text-blue-400 hover:text-blue-300 underline">
            Return to MCPeriscope
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex items-center justify-center bg-gray-900 text-white">
      <div className="text-center">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-gray-400">Redirecting...</p>
      </div>
    </div>
  );
}
