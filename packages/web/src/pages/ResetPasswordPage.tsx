import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { authService } from "../services/AuthService";
import { consumeSensitiveUrlToken } from "../services/sensitiveUrl";
import { Sparkles, AlertCircle, CheckCircle2, ArrowLeft } from "lucide-react";

export default function ResetPasswordPage() {
  const [token] = useState(() => consumeSensitiveUrlToken());
  const navigate = useNavigate();
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (pw !== confirm) return setError("Passwords do not match.");
    setLoading(true);
    try {
      await authService.resetPassword(token, pw);
      setDone(true);
      setTimeout(() => navigate("/login"), 2000);
    } catch (err: any) {
      setError(err.response?.data?.detail || "This reset link is invalid or has expired.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen grid place-items-center p-6 bg-grad-brand-anim">
      <div className="w-full max-w-sm card animate-grad-fade-up">
        <div className="flex items-center gap-3 mb-6">
          <div className="h-11 w-11 rounded-xl bg-grad-brand grid place-items-center shadow-grad-glow">
            <Sparkles size={20} className="text-white" />
          </div>
          <p className="text-lg font-bold tracking-tight text-primary">Oryza</p>
        </div>

        {done ? (
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-emerald-500/15 ring-1 ring-inset ring-emerald-500/40 text-sm font-medium text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
            <span>Password reset. Redirecting you to sign in…</span>
          </div>
        ) : !token ? (
          <div className="space-y-5">
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-rose-500/15 ring-1 ring-inset ring-rose-500/40 text-sm font-medium text-rose-700 dark:text-rose-300">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <span>This reset link is missing its token. Request a new one.</span>
            </div>
            <Link to="/forgot-password" className="inline-flex items-center gap-1.5 text-sm font-semibold text-grad-brand hover:opacity-80">
              Request a new reset link
            </Link>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-5">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-primary">Choose a new password</h1>
              <p className="mt-2 text-sm text-secondary">At least 8 characters, with letters and numbers.</p>
            </div>
            <div>
              <label className="form-label">New password</label>
              <input
                type="password"
                className="input"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                autoComplete="new-password"
                placeholder="••••••••"
                autoFocus
                required
              />
            </div>
            <div>
              <label className="form-label">Confirm new password</label>
              <input
                type="password"
                className="input"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                placeholder="••••••••"
                required
              />
            </div>
            {error && (
              <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-rose-500/15 ring-1 ring-inset ring-rose-500/40 text-sm font-medium text-rose-700 dark:text-rose-300">
                <AlertCircle size={16} className="mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
            <button type="submit" className="btn-primary w-full" disabled={loading || !pw || !confirm}>
              {loading ? "Resetting…" : "Reset password"}
            </button>
            <Link to="/login" className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-primary">
              <ArrowLeft size={14} /> Back to sign in
            </Link>
          </form>
        )}
      </div>
    </div>
  );
}
