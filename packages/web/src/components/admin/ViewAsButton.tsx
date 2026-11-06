import { useState } from "react";
import { createPortal } from "react-dom";
import { Eye, ShieldAlert } from "lucide-react";
import { adminService, type ViewAsMode } from "../../services/AdminService";
import { useEscapeKey } from "../../hooks/useEscapeKey";
import ConfirmItsYou from "../ConfirmItsYou";
import { reloadAs } from "../../services/api";
import { t } from "../../i18n";

type Person = { id: string; username: string; full_name?: string | null; is_active?: boolean };

function errorText(e: any): string {
  const detail = e?.response?.data?.detail;
  return typeof detail === "string" ? detail : t("That didn't work. Try again.");
}

/**
 * Opens a mill as this person sees it (backend core/view_as.py). Read-only is
 * the default; full control asks for the password and an authenticator code
 * every time. Either way the page reloads into the mill's app, with a banner
 * and a way back to BossAdmin.
 */
export default function ViewAsButton({ person, compact }: { person: Person; compact?: boolean }) {
  const [choosing, setChoosing] = useState(false);
  const [askingFull, setAskingFull] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const name = person.full_name || person.username;

  const start = async (mode: ViewAsMode, proof?: { password: string; code: string }) => {
    setBusy(true);
    setError(null);
    try {
      await adminService.startViewAs({
        user_id: person.id,
        mode,
        current_password: proof?.password,
        mfa_code: proof?.code,
      });
      await reloadAs("/");
    } catch (e) {
      setBusy(false);
      setError(errorText(e));
      if (mode === "full") setAskingFull(true);
    }
  };

  if (person.is_active === false) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setChoosing(true);
        }}
        className="btn-ghost px-2! py-1.5! text-xs"
        title={t("See the app as {{name}} sees it", { name })}
        aria-label={t("See the app as {{name}} sees it", { name })}
      >
        <Eye size={14} /> {compact ? null : t("View as")}
      </button>
      {choosing && (
        <ChooseMode
          name={name}
          busy={busy}
          error={askingFull ? null : error}
          onView={() => void start("view")}
          onFull={() => {
            setChoosing(false);
            setError(null);
            setAskingFull(true);
          }}
          onCancel={() => setChoosing(false)}
        />
      )}
      <ConfirmItsYou
        key={error ?? "first"}
        open={askingFull}
        usesCode
        reason={t(
          "Full control lets you change {{name}}'s records for real, and every change is logged as yours.",
          { name },
        )}
        error={error ?? undefined}
        onConfirm={(p) => {
          setAskingFull(false);
          void start("full", p);
        }}
        onCancel={() => {
          setAskingFull(false);
          setError(null);
        }}
      />
    </>
  );
}

function ChooseMode({
  name,
  busy,
  error,
  onView,
  onFull,
  onCancel,
}: {
  name: string;
  busy: boolean;
  error: string | null;
  onView: () => void;
  onFull: () => void;
  onCancel: () => void;
}) {
  useEscapeKey(onCancel);
  return createPortal(
    <div
      className="dialog-viewport fixed inset-0 z-80 grid place-items-center bg-black/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="view-as-title"
        className="dialog-panel card w-full max-w-md space-y-4 bg-white! dark:bg-slate-900!"
      >
        <div>
          <h3 id="view-as-title" className="text-lg font-bold text-primary">
            {t("View as {{name}}", { name })}
          </h3>
          <p className="text-sm text-secondary mt-1">
            {t(
              "You'll see every page exactly as they do. They won't see you there, but their mill's activity log records the visit.",
            )}
          </p>
        </div>
        {error && (
          <p role="alert" className="text-sm font-semibold text-rose-600 dark:text-rose-400">
            {error}
          </p>
        )}
        <div className="grid gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onView}
            className="btn-primary h-auto! py-3! flex-col items-start! text-left"
          >
            <span className="flex items-center gap-2">
              <Eye size={16} /> {t("Read-only")}
            </span>
            <span className="text-xs font-medium opacity-90">
              {t("Look around. Nothing can be saved, changed or deleted.")}
            </span>
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onFull}
            className="btn-secondary h-auto! py-3! flex-col items-start! text-left"
          >
            <span className="flex items-center gap-2 text-rose-600 dark:text-rose-400">
              <ShieldAlert size={16} /> {t("Full control")}
            </span>
            <span className="text-xs font-medium text-secondary">
              {t("Make changes as them. Needs your password and authenticator code.")}
            </span>
          </button>
        </div>
        <button type="button" onClick={onCancel} className="btn-ghost w-full">
          {t("Cancel")}
        </button>
      </div>
    </div>,
    document.body,
  );
}
