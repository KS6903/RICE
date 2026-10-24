import { useState } from "react";
import { LogOut, PauseCircle, RotateCcw, Trash2 } from "lucide-react";
import { authService } from "../services/AuthService";
import { useAuthStore } from "../stores/authStore";
import DataExport from "./DataExport";

const day = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { dateStyle: "long" }) : "";

/**
 * Shown, in place of the whole app, to the Boss of a mill they closed
 * themselves (/me's `account.state`): paused, or with deletion asked for. The
 * server keeps everything else shut, so this reopens the account or downloads
 * its data, and nothing more.
 */
export default function AccountClosedGate() {
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const logout = useAuthStore((s) => s.logout);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const account = user?.account;
  const deleting = account?.state === "deletion_requested";

  const reopen = async () => {
    setError("");
    setBusy(true);
    try {
      await authService.reopenAccount();
      setUser(await authService.me());
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Couldn't reopen the account.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen grid place-items-center p-6 bg-grad-brand-anim">
      <div className="w-full max-w-lg card animate-grad-fade-up space-y-5">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-xl bg-grad-brand grid place-items-center shadow-grad-glow">
            {deleting ? (
              <Trash2 size={20} className="text-white" aria-hidden />
            ) : (
              <PauseCircle size={20} className="text-white" aria-hidden />
            )}
          </div>
          <div>
            <h1 className="text-xl font-bold text-primary">
              {deleting ? "This account is set to be deleted" : "This account is paused"}
            </h1>
            <p className="text-sm text-secondary">
              {deleting
                ? `You asked on ${day(account?.deletion_requested_at)} for the mill's account to be deleted.`
                : `You paused it on ${day(account?.closed_at)}. Nobody but you can sign in.`}
            </p>
          </div>
        </div>

        {deleting ? (
          <>
            <p className="text-sm text-secondary">
              Until {day(account?.export_until)} you can download the mill&apos;s data, or take the
              request back and keep using the app. After that, Oraiza deletes the mill&apos;s
              records.
            </p>
            <DataExport />
          </>
        ) : (
          <p className="text-sm text-secondary">
            Switch it back on to open the app for everyone again. Nothing was deleted.
          </p>
        )}

        {error && <p className="text-sm font-medium text-rose-600 dark:text-rose-400">{error}</p>}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-primary inline-flex items-center gap-1.5"
            disabled={busy}
            onClick={reopen}
          >
            <RotateCcw size={15} aria-hidden />
            {deleting ? "Keep my account" : "Switch it back on"}
          </button>
          <button
            type="button"
            className="btn-secondary inline-flex items-center gap-1.5"
            onClick={() => void logout()}
          >
            <LogOut size={15} aria-hidden /> Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
