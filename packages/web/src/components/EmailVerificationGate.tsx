import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { authService } from "../services/AuthService";
import { useAuthStore } from "../stores/authStore";
import { MailCheck, AlertCircle, Check, LogOut, RefreshCw } from "lucide-react";

/** Full-screen blocker shown (in place of the app) when /me reports
 *  email_verification_required — i.e. REQUIRE_EMAIL_VERIFICATION is on and the
 *  user hasn't confirmed their address. The server already blocks data
 *  endpoints, so the only ways forward are: verify (via the emailed link, then
 *  refresh) or sign out. */
export default function EmailVerificationGate() {
  const qc = useQueryClient();
  const logout = useAuthStore((s) => s.logout);
  const email = useAuthStore((s) => s.user?.email);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const resend = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await authService.resendVerification();
      setMsg({ type: "ok", text: "Verification email sent. Check your inbox." });
    } catch {
      setMsg({ type: "err", text: "Couldn't send the email. Try again shortly." });
    } finally {
      setBusy(false);
    }
  };

  // The link verifies server-side; this just re-checks /me so the gate lifts.
  const refresh = () => qc.invalidateQueries({ queryKey: ["auth-me"] });

  return (
    <div className="min-h-screen grid place-items-center p-6 bg-grad-brand-anim">
      <div className="w-full max-w-md card animate-grad-fade-up space-y-5">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-xl bg-grad-brand grid place-items-center shadow-grad-glow">
            <MailCheck size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-primary">Verify your email</h1>
            <p className="text-sm text-secondary">
              We sent a link to {email ? <span className="font-semibold">{email}</span> : "your email"}. Click it to continue.
            </p>
          </div>
        </div>

        {msg && (
          <div
            className={`flex items-start gap-2 px-3 py-2.5 rounded-xl text-sm font-medium ring-1 ring-inset ${
              msg.type === "ok"
                ? "bg-emerald-500/15 ring-emerald-500/40 text-emerald-700 dark:text-emerald-300"
                : "bg-rose-500/15 ring-rose-500/40 text-rose-700 dark:text-rose-300"
            }`}
          >
            {msg.type === "ok" ? <Check size={16} className="mt-0.5 shrink-0" /> : <AlertCircle size={16} className="mt-0.5 shrink-0" />}
            <span>{msg.text}</span>
          </div>
        )}

        <div className="flex gap-2">
          <button onClick={refresh} className="btn-primary flex-1 inline-flex items-center justify-center gap-1.5">
            <RefreshCw size={15} /> I&apos;ve verified
          </button>
          <button onClick={resend} disabled={busy} className="btn-secondary flex-1">
            {busy ? "Sending…" : "Resend email"}
          </button>
        </div>

        <button
          onClick={logout}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-primary transition-colors"
        >
          <LogOut size={14} /> Sign out
        </button>
      </div>
    </div>
  );
}
