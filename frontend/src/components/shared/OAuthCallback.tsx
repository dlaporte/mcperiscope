import { useEffect, useState } from "react";
import { useStore } from "../../store";

export function OAuthCallback() {
  const { completeOAuth, connected, error } = useStore();
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

    // Send the full callback URL — the backend needs it for the OAuth code exchange
    const callbackUrl = window.location.href;
    completeOAuth(callbackUrl);
  }, [completeOAuth]);

  if (connected) {
    window.location.replace("/");
    return null;
  }

  const displayError = localError || error;

  return (
    <div className="h-screen flex items-center justify-center bg-gray-900 text-white">
      <div className="text-center">
        {displayError ? (
          <>
            <p className="text-red-400 text-lg mb-4">{displayError}</p>
            <a
              href="/"
              className="text-blue-400 hover:text-blue-300 underline"
            >
              Return to MCPeriscope
            </a>
          </>
        ) : (
          <>
            <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-gray-400">Completing OAuth authorization...</p>
          </>
        )}
      </div>
    </div>
  );
}
