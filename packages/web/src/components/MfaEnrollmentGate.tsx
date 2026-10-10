import { useState } from "react";
import { authService } from "../services/AuthService";
import { useAuthStore } from "../stores/authStore";
import { ShieldCheck, AlertCircle, Check, LogOut } from "lucide-react";
import BackupCodes from "./BackupCodes";

/** Full-screen mandatory MFA enrollment.
 *
 * Shown (in place of the whole app) when /me reports `mfa_enrollment_required` —
 * i.e. a privileged role with enforcement on that hasn't enrolled. The server
 * already blocks data endpoints, so this is the only way forward besides logout.
 * On success we invalidate the auth-me query; the refetch clears the flag and
 * the app renders normally. */
export default function MfaEnrollmentGate() {
  const logout = useAuthStore((s) => s.logout);
  const requireReauthentication = useAuthStore((s) => s.requireReauthentication);
  const [enroll, setEnroll] = useState<{ secret: string; otpauth_uri: string } | null>(null);
  const [code, setCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const start = async () => {
    setError("");
    setLoading(true);
    try {
      setEnroll(await authService.mfaEnroll());
    } catch (e: any) {
      setError(e.response?.data?.detail || "Could not start enrollment.");
    } finally {
      setLoading(false);
    }
  };

  const confirm = async () => {
    setError("");
    setLoading(true);
    try {
      const res = await authService.mfaEnrollVerify(code.trim());
      // Show the recovery codes before letting the gate lift.
      setBackupCodes(res.backup_codes);
      requireReauthentication();
    } catch (e: any) {
      setError(e.response?.data?.detail || "Invalid code. Check your authenticator app.");
    } finally {
      setLoading(false);
    }
  };

  const finish = async () => {
    await logout();
  };

  return (
    <div className="min-h-screen grid place-items-center p-6 bg-grad-brand-anim">
      <div className="w-full max-w-md card animate-grad-fade-up space-y-5">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-xl bg-grad-brand grid place-items-center shadow-grad-glow">
            <ShieldCheck size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-primary">Two-factor authentication required</h1>
            <p className="text-sm text-secondary">
              Your role requires 2FA before you can continue.
            </p>
          </div>
        </div>

        {backupCodes ? (
          <div className="space-y-4">
            <BackupCodes codes={backupCodes} />
            <button onClick={finish} className="btn-primary w-full">
              I&apos;ve saved my codes, sign in again
            </button>
          </div>
        ) : !enroll ? (
          <button onClick={start} className="btn-primary w-full" disabled={loading}>
            {loading ? "Starting…" : "Set up two-factor authentication"}
          </button>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-secondary">
              Add this key to your authenticator app (Google Authenticator, Authy, 1Password…), then
              enter the 6-digit code it shows.
            </p>
            <div className="px-3 py-2.5 rounded-xl bg-slate-500/10 ring-1 ring-inset ring-slate-500/30 font-mono text-sm break-all select-all">
              {enroll.secret}
            </div>
            <input
              className="input text-center tracking-[0.4em]"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="••••••"
              autoFocus
            />
            <button
              onClick={confirm}
              className="btn-primary w-full"
              disabled={loading || code.length < 6}
            >
              {loading ? "Verifying…" : "Confirm & enable"}
            </button>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-rose-500/15 ring-1 ring-inset ring-rose-500/40 text-sm font-medium text-rose-700 dark:text-rose-300">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex items-center justify-between pt-1">
          <span className="inline-flex items-center gap-1.5 text-xs text-muted">
            <Check size={13} /> Stored securely, encrypted at rest
          </span>
          <button
            onClick={logout}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-primary transition-colors"
          >
            <LogOut size={14} /> Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
