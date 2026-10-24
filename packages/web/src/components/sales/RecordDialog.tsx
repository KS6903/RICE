import { createPortal } from "react-dom";
import { X as XIcon } from "lucide-react";
import { useEscapeKey } from "../../hooks/useEscapeKey";

/**
 * The frame for a sales record's edit or history dialog: a title, the body,
 * and an optional footer. Rendered into <body>, as InvoicePreviewModal is: the
 * page's content wrapper is animated, and a transformed ancestor would trap a
 * fixed backdrop inside it. Escape and the backdrop close it, except while busy.
 */
export default function RecordDialog({
  title,
  subtitle,
  onClose,
  busy = false,
  footer,
  children,
  testId,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  busy?: boolean;
  footer?: React.ReactNode;
  children: React.ReactNode;
  testId?: string;
}) {
  useEscapeKey(onClose, !busy);
  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-testid={testId}
    >
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
        onClick={() => !busy && onClose()}
      />
      <div className="relative flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-[rgb(var(--surface-raised))] shadow-2xl ring-1 ring-soft">
        <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3 border-b border-soft">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-primary">{title}</h3>
            {subtitle && <p className="text-sm text-secondary mt-0.5">{subtitle}</p>}
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            disabled={busy}
            className="btn-ghost !p-1.5"
          >
            <XIcon size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 px-5 py-3 border-t border-soft">{footer}</div>
        )}
      </div>
    </div>,
    document.body,
  );
}
