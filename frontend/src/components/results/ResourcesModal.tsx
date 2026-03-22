import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface ResourceData {
  name: string;
  original: string;
  condensed: string;
  originalTokens: number;
  condensedTokens: number;
}

interface Props {
  resources: Record<string, ResourceData>;
  onClose: () => void;
}

export function ResourcesModal({ resources, onClose }: Props) {
  const entries = Object.entries(resources);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="relative w-full max-w-5xl max-h-[90vh] flex flex-col rounded-lg overflow-hidden"
        style={{ backgroundColor: 'var(--sub-panel)', border: '1px solid var(--sub-rivet)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 shrink-0" style={{ borderBottom: '1px solid var(--sub-rivet)' }}>
          <h3 className="text-lg font-semibold font-stencil" style={{ color: 'var(--sub-text)' }}>
            Resources
          </h3>
          <button
            onClick={onClose}
            className="text-lg px-2 py-0.5 rounded hover:opacity-80"
            style={{ color: 'var(--sub-text-dim)' }}
          >
            &#x2715;
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {entries.length === 0 && (
            <p className="text-sm" style={{ color: 'var(--sub-text-dim)' }}>No condensed resources to display.</p>
          )}
          {entries.map(([uri, data]) => {
            const savings = data.originalTokens > 0
              ? Math.round((1 - data.condensedTokens / data.originalTokens) * 100)
              : 0;
            return (
              <div key={uri} className="panel-riveted rounded-lg overflow-hidden">
                {/* Resource name */}
                <div className="px-4 py-2" style={{ borderBottom: '1px solid var(--sub-rivet)' }}>
                  <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--sub-text-dim)' }}>
                    Resource
                  </span>
                  <p className="text-sm mt-0.5 font-medium" style={{ color: 'var(--sub-text)' }}>{data.name}</p>
                  <p className="text-[10px] mt-0.5" style={{ color: 'var(--sub-text-dim)' }}>{uri}</p>
                </div>

                {/* Two columns */}
                <div className="grid grid-cols-2 gap-0">
                  <div className="p-3" style={{ borderRight: '1px solid var(--sub-rivet)' }}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--sub-text-dim)' }}>
                        Original
                      </div>
                      <div className="text-[10px]" style={{ color: 'var(--sub-text-dim)' }}>
                        {data.originalTokens.toLocaleString()} tokens
                      </div>
                    </div>
                    <div
                      className="p-3 rounded text-xs overflow-auto max-h-64 prose prose-sm prose-invert max-w-none"
                      style={{ backgroundColor: 'var(--sub-hull)', border: '1px solid var(--sub-rivet)' }}
                    >
                      <Markdown remarkPlugins={[remarkGfm]}>{data.original || "No content"}</Markdown>
                    </div>
                  </div>
                  <div className="p-3">
                    <div className="flex items-center justify-between mb-1">
                      <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--sub-text-dim)' }}>
                        Condensed
                      </div>
                      <div className="text-[10px]" style={{ color: 'var(--sub-text-dim)' }}>
                        {data.condensedTokens.toLocaleString()} tokens
                        {savings > 0 && (
                          <span style={{ color: 'var(--sub-green, #4ade80)' }}> ({savings}% saved)</span>
                        )}
                      </div>
                    </div>
                    <div
                      className="p-3 rounded text-xs overflow-auto max-h-64 prose prose-sm prose-invert max-w-none"
                      style={{ backgroundColor: 'var(--sub-hull)', border: '1px solid var(--sub-rivet)' }}
                    >
                      <Markdown remarkPlugins={[remarkGfm]}>{data.condensed || "No content"}</Markdown>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
