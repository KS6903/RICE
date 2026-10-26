// A centred popup window: portalled to <body> so it sits in the middle of the
// screen whatever the page is doing, closed by Esc, the × or a click outside,
// and scrolling inside itself when it's taller than the screen.
import { useEffect, useId, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X as XIcon } from "lucide-react";
import { t } from "../i18n";

export default function Modal({
  open,
  title,
  subtitle,
  onClose,
  children,
  footer,
  size = "md",
  testId,
}: {
  open: boolean;
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** Buttons pinned under the scrolling body. */
  footer?: ReactNode;
  size?: "md" | "lg" | "xl";
  testId?: string;
}) {
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const width = { md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl" }[size];
  return createPortal(
    <div
      className="dialog-viewport fixed inset-0 z-50 grid place-items-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-testid={testId}
    >
      <div
        aria-hidden
        className="absolute inset-0 bg-slate-900/45 backdrop-blur-sm animate-grad-fade-up"
        onClick={onClose}
      />
      <div
        className={`dialog-panel relative w-full ${width} flex flex-col overflow-hidden rounded-2xl glass-strong ring-1 ring-soft shadow-2xl animate-grad-fade-up`}
      >
        <div className="flex items-start justify-between gap-3 border-b border-soft px-5 py-4">
          <div className="min-w-0">
            <h3 id={titleId} className="text-lg font-bold text-primary">
              {title}
            </h3>
            {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn-ghost !p-1.5 shrink-0"
            aria-label={t("Close")}
          >
            <XIcon size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-soft px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
