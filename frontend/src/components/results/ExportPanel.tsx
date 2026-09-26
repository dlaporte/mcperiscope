import { useState } from "react";
import { requestText } from "../../api/client";

interface DownloadButton {
  label: string;
  endpoint: string;  // path under /api
  filename: string;
  type: string;      // MIME type of the saved file
}

interface ExportPanelProps {
  runId: string;
}

function getDownloads(runId: string): DownloadButton[] {
  const run = `/results/runs/${encodeURIComponent(runId)}`;
  return [
    {
      label: "Download Plan",
      endpoint: `${run}/plan`,
      filename: "optimization-plan.md",
      type: "text/markdown",
    },
    {
      label: "Download Report",
      endpoint: `${run}/report/html`,
      filename: "optimization-report.html",
      type: "text/html",
    },
    {
      label: "Download Proxy",
      endpoint: `${run}/proxy`,
      filename: "proxy_server.py",
      type: "text/x-python",
    },
  ];
}

async function triggerDownload(dl: DownloadButton) {
  const text = await requestText(dl.endpoint);
  const url = URL.createObjectURL(new Blob([text], { type: dl.type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = dl.filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function ExportPanel({ runId }: ExportPanelProps) {
  const [downloading, setDownloading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const DOWNLOADS = getDownloads(runId);

  async function handleDownload(dl: DownloadButton) {
    setDownloading(dl.endpoint);
    setError(null);
    try {
      await triggerDownload(dl);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setDownloading(null);
    }
  }

  return (
    <div className="panel-riveted rounded-lg p-4">
      <h3 className="text-lg font-semibold font-stencil mb-3" style={{ color: 'var(--sub-text)' }}>Export</h3>
      <div className="flex flex-wrap gap-3">
        {DOWNLOADS.map((dl) => (
          <button
            key={dl.endpoint}
            onClick={() => handleDownload(dl)}
            disabled={downloading !== null}
            className="px-4 py-2 disabled:opacity-50 disabled:cursor-not-allowed
                       text-sm font-medium rounded-lg border
                       transition-colors flex items-center gap-2
                       bg-[var(--sub-panel-light)] text-[var(--sub-text)]
                       hover:bg-[var(--sub-rivet)] hover:text-[var(--sub-text-bright)]"
            style={{ borderColor: 'var(--sub-rivet)' }}
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
        <p className="alarm-text text-sm mt-2">{error}</p>
      )}
    </div>
  );
}
