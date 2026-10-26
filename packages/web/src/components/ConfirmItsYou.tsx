import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { ShieldCheck } from "lucide-react";
import PasswordInput from "./PasswordInput";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { t } from "../i18n";

/** What the signed-in person typed to prove it is them. */
export type Proof = { password: string; code: string };

type Props = {
  open: boolean;
  /** What is being handed over, as a phrase: "a Boss", "an Admin". */
  what?: string;
  /** Why it needs confirming, as a sentence, for anything other than handing
   *  over a role: "Restoring replaces every record your mill keeps." */
  reason?: string;
  /** The person uses two-factor, so a current authenticator code is asked for too. */
  usesCode: boolean;
  /** Why the last try was refused, when this is a second asking. */
  error?: string;
  onConfirm: (proof: Proof) => void;
  onCancel: () => void;
};

const LABEL = "block text-sm font-medium text-gray-700 dark:text-slate-200 mb-1";

/**
 * A popup that asks the signed-in person to prove it is them (their own
 * password, and an authenticator code if they use one) before something that
 * hands over control of the mill. It only collects what was typed; the server
 * does the checking.
 *
 * Enter confirms, Escape or a press on the backdrop cancels, and focus returns
 * to what opened it. It opens empty every time.
 */
export default function ConfirmItsYou(props: Props) {
  return props.open ? <Asking {...props} /> : null;
}

function Asking({ what, reason, usesCode, error, onConfirm, onCancel }: Props) {
  const titleId = `confirm-you-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const ready = password !== "" && (!usesCode || /^\d{6}$/.test(code));

  useEscapeKey(onCancel);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    return () => opener?.focus?.();
  }, []);

  return createPortal(
    <div
      className="dialog-viewport fixed inset-0 z-[80] grid place-items-center bg-black/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="dialog-panel card w-full max-w-md overflow-y-auto !bg-white dark:!bg-slate-900"
      >
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (ready) onConfirm({ password, code });
          }}
        >
          <div className="flex items-start gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400">
              <ShieldCheck size={20} aria-hidden />
            </div>
            <div className="min-w-0 space-y-1.5">
              <h3 id={titleId} className="text-lg font-bold text-primary">
                {t("Confirm it is you")}
              </h3>
              <p className="text-sm text-secondary">
                {reason ??
                  t("Making someone {{what}} gives them control of the mill.", {
                    what: what ?? t("a Boss"),
                  })}{" "}
                {usesCode
                  ? t(
                      "Enter your own password and the code from your authenticator app to continue.",
                    )
                  : t("Enter your own password to continue.")}
              </p>
            </div>
          </div>

          {error && (
            <p role="alert" className="text-sm font-semibold text-rose-600 dark:text-rose-400">
              {error}
            </p>
          )}

          <div>
            <label htmlFor={`${titleId}-password`} className={LABEL}>
              {t("Your password")}
            </label>
            {/* Typed by hand every time: a password manager must not fill it. A
                browser leaves a "new-password" field alone, and the data
                attributes are the opt-outs 1Password, LastPass and Bitwarden
                look for. */}
            <PasswordInput
              id={`${titleId}-password`}
              name={`${titleId}-confirm`}
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              data-1p-ignore
              data-lpignore="true"
              data-bwignore="true"
              autoFocus
            />
          </div>

          {usesCode && (
            <div>
              <label htmlFor={`${titleId}-code`} className={LABEL}>
                {t("Authenticator code")}
              </label>
              <input
                id={`${titleId}-code`}
                className="input font-mono tracking-widest"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                autoComplete="one-time-code"
                inputMode="numeric"
                placeholder={t("6-digit code")}
              />
            </div>
          )}

          <div className="flex gap-2">
            <button type="submit" disabled={!ready} className="btn-primary flex-1">
              {t("Confirm")}
            </button>
            <button type="button" onClick={onCancel} className="btn-secondary flex-1">
              {t("Cancel")}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
