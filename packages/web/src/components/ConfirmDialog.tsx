import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle } from "lucide-react";
import { clsx } from "clsx";
import { useEscapeKey } from "../hooks/useEscapeKey";

type Props = {
  open: boolean;
  title: string;
  /** The consequence, in a sentence or two. */
  children?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** The action removes something: the confirm button is red. */
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * The app's own confirmation, in place of the browser's window.confirm. Focus
 * lands on Cancel, so a stray Enter never confirms; Escape or a press on the
 * backdrop cancels, and focus returns to whatever opened it.
 */
export default function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: Props) {
  const titleId = `confirm-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEscapeKey(onCancel, open);

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    return () => opener?.focus?.();
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className="dialog-viewport fixed inset-0 z-[80] grid place-items-center bg-black/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="dialog-panel card w-full max-w-md overflow-y-auto space-y-4 !bg-white dark:!bg-slate-900"
      >
        <div className="flex items-start gap-3">
          <div
            className={clsx(
              "grid h-11 w-11 shrink-0 place-items-center rounded-xl",
              danger
                ? "bg-rose-500/15 text-rose-600 dark:text-rose-400"
                : "bg-grad-brand text-white",
            )}
          >
            <AlertTriangle size={18} aria-hidden />
          </div>
          <div className="min-w-0 space-y-1.5">
            <h3 id={titleId} className="text-lg font-bold text-primary">
              {title}
            </h3>
            {children && <div className="text-sm text-secondary">{children}</div>}
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={clsx("flex-1", danger ? "btn-danger" : "btn-primary")}
          >
            {confirmLabel}
          </button>
          <button ref={cancelRef} type="button" onClick={onCancel} className="btn-secondary flex-1">
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
