import { useState } from "react";

interface DownloadButton {
  label: string;
  endpoint: string;
  filename: string;
}

const DOWNLOADS: DownloadButton[] = [
  {
    label: "Download Plan (.md)",
    endpoint: "/api/results/plan",
    filename: "optimization-plan.md",
  },
  {
    label: "Download Report (.md)",
    endpoint: "/api/results/report/md",
    filename: "optimization-report.md",
  },
  {
    label: "Download Report (.html)",
    endpoint: "/api/results/report/html",
    filename: "optimization-report.html",
  },
  {
    label: "Download Proxy (.py)",
    endpoint: "/api/results/proxy",
    filename: "proxy_server.py",
  },
];

async function triggerDownload(endpoint: string, filename: string) {
  const res = await fetch(endpoint);
  if (!res.ok) {
    const text = await res.text();
    let detail = text;
    try {
      detail = JSON.parse(text).detail || text;
    } catch {
      // use raw text
    }
    throw new Error(detail);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function ExportPanel() {
  const [downloading, setDownloading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleDownload(dl: DownloadButton) {
    setDownloading(dl.endpoint);
    setError(null);
    try {
      await triggerDownload(dl.endpoint, dl.filename);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setDownloading(null);
    }
  }

  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
      <h3 className="text-lg font-semibold text-white mb-3">Export</h3>
      <div className="flex flex-wrap gap-3">
        {DOWNLOADS.map((dl) => (
          <button
            key={dl.endpoint}
            onClick={() => handleDownload(dl)}
            disabled={downloading !== null}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed
                       text-gray-200 text-sm font-medium rounded-lg border border-gray-600
                       transition-colors flex items-center gap-2"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5m0 0l5-5m-5 5V4"
              />
            </svg>
            {downloading === dl.endpoint ? "Downloading..." : dl.label}
          </button>
        ))}
      </div>
      {error && (
        <p className="text-red-400 text-sm mt-2">{error}</p>
      )}
    </div>
  );
}
