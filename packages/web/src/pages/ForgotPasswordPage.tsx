import { useState } from "react";
import { Link } from "react-router-dom";
import { authService } from "../services/AuthService";
import { Sparkles, AlertCircle, MailCheck, ArrowLeft } from "lucide-react";

export default function ForgotPasswordPage() {
  const [identifier, setIdentifier] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  // Dev-only convenience: when the backend exposes the reset token (EXPOSE_RESET_TOKEN),
  // surface the link so the flow is testable without an email provider.
  const [devLink, setDevLink] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await authService.forgotPassword(identifier.trim());
      setSent(true);
      if (res.reset_token) {
        setDevLink(`/reset-password?token=${encodeURIComponent(res.reset_token)}`);
      }
    } catch {
      // Enumeration-safe endpoint shouldn't error; show a generic message if it does.
      setError("Something went wrong. Please try again.");
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
          <p className="text-lg font-bold tracking-tight text-primary">Oryza by K Systematics</p>
        </div>

        {sent ? (
          <div className="space-y-5">
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-emerald-500/15 ring-1 ring-inset ring-emerald-500/40 text-sm font-medium text-emerald-700 dark:text-emerald-300">
              <MailCheck size={16} className="mt-0.5 shrink-0" />
              <span>If an account matches, we&apos;ve sent a reset link. Check your email.</span>
            </div>
            {devLink && (
              <Link to={devLink} className="block text-sm font-semibold text-grad-brand hover:opacity-80 break-all">
                Dev reset link → {devLink}
              </Link>
            )}
            <Link to="/login" className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-primary">
              <ArrowLeft size={14} /> Back to sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-5">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-primary">Reset your password</h1>
              <p className="mt-2 text-sm text-secondary">
                Enter your username or email and we&apos;ll send you a reset link.
              </p>
            </div>
            <div>
              <label className="form-label">Username or email</label>
              <input
                className="input"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                autoComplete="username"
                placeholder="your.username"
                autoFocus
                required
              />
            </div>
            {error && (
              <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-rose-500/15 ring-1 ring-inset ring-rose-500/40 text-sm font-medium text-rose-700 dark:text-rose-300">
                <AlertCircle size={16} className="mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
            <button type="submit" className="btn-primary w-full" disabled={loading || !identifier.trim()}>
              {loading ? "Sending…" : "Send reset link"}
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
