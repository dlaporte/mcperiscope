import { useEffect, useId, useRef } from "react";

interface Props {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  headerExtra?: React.ReactNode; // shown after the title (counts, section tabs)
  panelClassName: string;        // size and layout of the dialog box
  panelStyle?: React.CSSProperties;
  headerClassName?: string;
  headerStyle?: React.CSSProperties;
  titleClassName?: string;
  backdrop?: string;
}

// Dialog shell: backdrop click and Escape close it, focus moves in on open and
// back to the opener on close.
export function Modal({
  title,
  onClose,
  children,
  headerExtra,
  panelClassName,
  panelStyle,
  headerClassName = "px-4 py-3",
  headerStyle,
  titleClassName = "text-lg font-semibold font-stencil",
  backdrop = "rgba(0,0,0,0.7)",
}: Props) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: backdrop }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`${panelClassName} outline-none`}
        style={panelStyle}
      >
        <div
          className={`flex items-center justify-between shrink-0 ${headerClassName}`}
          style={{ borderBottom: '1px solid var(--sub-rivet)', ...headerStyle }}
        >
          <div className="flex items-center gap-4">
            <h2 id={titleId} className={titleClassName} style={{ color: 'var(--sub-text)' }}>
              {title}
            </h2>
            {headerExtra}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-lg leading-none px-2 py-0.5 rounded text-[var(--sub-text-dim)] hover:text-[var(--sub-text)]"
          >
            &#x2715;
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
