import { useState } from "react";
import { AlertCircle, Check, KeyRound, LogOut } from "lucide-react";
import { authService } from "../services/AuthService";
import { useAuthStore } from "../stores/authStore";
import PasswordInput from "./PasswordInput";
import { t } from "../i18n";

/** Full-screen "choose your own password".
 *
 * Shown (in place of the whole app) when /me reports `password_change_required`:
 * the person signed in on a temporary password, given to them after a lockout by
 * their Boss or the admin. The server already blocks data endpoints until they
 * choose one, so this is the only way forward besides signing out. Changing it
 * signs them out everywhere (the server revokes every session), so they sign in
 * again with the new one. */
export default function PasswordChangeGate() {
  const logout = useAuthStore((s) => s.logout);
  const requireReauthentication = useAuthStore((s) => s.requireReauthentication);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const mismatch = again.length > 0 && next !== again;
  const ready = current.length > 0 && next.length >= 8 && next === again;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setLoading(true);
    setError("");
    try {
      await authService.changePassword(current, next);
      // Every session was revoked: stop the /me poll bouncing us before the user
      // has seen that it worked.
      requireReauthentication();
      setDone(true);
    } catch (err: any) {
      setError(err.response?.data?.detail || t("Couldn't change the password. Try again."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen grid place-items-center p-6 bg-grad-brand-anim">
      <div className="w-full max-w-md card animate-grad-fade-up space-y-5">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-xl bg-grad-brand grid place-items-center shadow-grad-glow">
            <KeyRound size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-primary">{t("Choose your own password")}</h1>
            <p className="text-sm text-secondary">
              {t("You signed in with a temporary password. Choose one only you know.")}
            </p>
          </div>
        </div>

        {done ? (
          <div className="space-y-4">
            <p className="flex items-start gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
              <Check size={16} className="mt-0.5 shrink-0" /> {t("Your password was changed.")}
            </p>
            <button type="button" className="btn-primary w-full" onClick={() => void logout()}>
              {t("Sign in with your new password")}
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label htmlFor="temp-current" className="form-label">
                {t("Temporary password")}
              </label>
              <PasswordInput
                id="temp-current"
                className="input"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>
            <div>
              <label htmlFor="temp-new" className="form-label">
                {t("New password")}
              </label>
              <PasswordInput
                id="temp-new"
                className="input"
                value={next}
                onChange={(e) => setNext(e.target.value)}
                autoComplete="new-password"
                required
              />
              <p className="mt-1 text-xs text-secondary">
                {t("At least 8 characters, with letters and numbers. Not the temporary one.")}
              </p>
            </div>
            <div>
              <label htmlFor="temp-again" className="form-label">
                {t("New password again")}
              </label>
              <PasswordInput
                id="temp-again"
                className="input"
                value={again}
                onChange={(e) => setAgain(e.target.value)}
                autoComplete="new-password"
                required
              />
              {mismatch && (
                <p className="mt-1 text-xs font-semibold text-rose-600 dark:text-rose-400">
                  {t("The two passwords don't match.")}
                </p>
              )}
            </div>

            {error && (
              <div
                className="flex items-start gap-2 rounded-xl bg-rose-500/15 px-3 py-2.5 text-sm font-medium text-rose-700 ring-1 ring-inset ring-rose-500/40 dark:text-rose-300"
                role="alert"
              >
                <AlertCircle size={16} className="mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <button type="submit" className="btn-primary w-full" disabled={!ready || loading}>
              {loading ? t("Saving…") : t("Save new password")}
            </button>
            <button
              type="button"
              onClick={() => void logout()}
              className="btn-ghost w-full justify-center"
            >
              <LogOut size={15} /> {t("Sign out")}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
