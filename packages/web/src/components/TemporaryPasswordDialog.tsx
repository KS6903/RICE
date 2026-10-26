import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Copy, KeyRound } from "lucide-react";
import type { TemporaryPassword } from "../services/UsersService";

function errorText(error: unknown, fallback: string): string {
  const detail = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  return typeof detail === "string" ? detail : fallback;
}

/**
 * Gives someone who is locked out a temporary password, and shows it once.
 *
 * Two steps, so it is never issued by accident: say what it does, then issue it.
 * The password is shown exactly once, here: it is never emailed, and the server
 * keeps only a hash, so closing this loses it (issue another if it's lost). The
 * person it is for must choose their own password at first sign-in, and the
 * temporary one expires.
 *
 * Rendered into <body>: the page's content wrapper is animated, and a transformed
 * ancestor would trap a `fixed` backdrop inside it, leaving the sidebar uncovered.
 */
export default function TemporaryPasswordDialog({
  name,
  issue,
  onClose,
}: {
  /** Whose password: shown in the words of the dialog. */
  name: string;
  issue: () => Promise<TemporaryPassword>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [given, setGiven] = useState<TemporaryPassword | null>(null);
  const [copied, setCopied] = useState(false);
  const primary = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    primary.current?.focus();
  }, [given]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const give = async () => {
    setBusy(true);
    setError("");
    try {
      setGiven(await issue());
    } catch (e) {
      setError(errorText(e, "Couldn't give a temporary password. Try again."));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!given) return;
    try {
      await navigator.clipboard.writeText(given.temporary_password);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable: the password is on screen to read out */
    }
  };

  const expires = given
    ? new Date(given.expires_at).toLocaleString(undefined, {
        weekday: "short",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

  return createPortal(
    <div className="dialog-viewport fixed inset-0 z-[80] grid place-items-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="temp-password-title"
        className="dialog-panel card w-full max-w-md overflow-y-auto space-y-4 !bg-white dark:!bg-slate-900"
      >
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-grad-brand shadow-grad-glow">
            <KeyRound size={18} className="text-white" />
          </div>
          <h3 id="temp-password-title" className="text-lg font-bold text-primary">
            {given ? `Temporary password for ${name}` : `Give ${name} a temporary password?`}
          </h3>
        </div>

        {!given ? (
          <>
            <p className="text-sm text-secondary">
              Use this when {name} is locked out or has forgotten their password. It replaces their
              password, unlocks their account and signs them out everywhere. They must choose their
              own password the first time they sign in, and this one stops working after 24 hours.
            </p>
            <p className="text-sm text-secondary">
              You will see it once. Tell {name} yourself, in person or by phone.
            </p>
            {error && (
              <p className="text-sm font-semibold text-rose-600 dark:text-rose-400" role="alert">
                {error}
              </p>
            )}
            <div className="flex gap-2">
              <button
                ref={primary}
                type="button"
                onClick={give}
                disabled={busy}
                className="btn-primary flex-1"
              >
                {busy ? "Working…" : "Give temporary password"}
              </button>
              <button type="button" onClick={onClose} className="btn-secondary flex-1">
                Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <output
                aria-label="Temporary password"
                className="flex-1 select-all break-all rounded-xl bg-slate-500/10 px-3 py-3 text-center font-mono text-xl font-bold tracking-wider text-primary ring-1 ring-inset ring-slate-500/30"
              >
                {given.temporary_password}
              </output>
              <button
                type="button"
                onClick={copy}
                className="btn-secondary !px-3"
                aria-label="Copy the temporary password"
              >
                {copied ? <Check size={16} /> : <Copy size={16} />}
              </button>
            </div>
            <p className="text-sm text-secondary">
              This is the only time you will see it, so pass it on now: in person or by phone, not
              in a group chat. It stops working on <strong>{expires}</strong>, and {name} chooses
              their own password when they first sign in with it.
            </p>
            <button ref={primary} type="button" onClick={onClose} className="btn-primary w-full">
              Done
            </button>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
