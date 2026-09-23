import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { authService } from "../services/AuthService";
import { consumeSensitiveUrlToken } from "../services/sensitiveUrl";
import { Sparkles, CheckCircle2, AlertCircle, Loader2, ArrowLeft } from "lucide-react";

/** Lands from the emailed verification link (/verify-email#token=…) and confirms
 *  the address. Unauthenticated — anyone with the link can complete it. */
export default function VerifyEmailPage() {
  const [token] = useState(() => consumeSensitiveUrlToken());
  const [state, setState] = useState<"loading" | "ok" | "error">(token ? "loading" : "error");
  const [error, setError] = useState("This verification link is missing its token.");
  const ran = useRef(false);

  useEffect(() => {
    if (!token || ran.current) return;
    ran.current = true; // guard React 18 StrictMode double-invoke (token is single-use)
    authService
      .verifyEmail(token)
      .then(() => setState("ok"))
      .catch((e: any) => {
        setError(e.response?.data?.detail || "This verification link is invalid or has expired.");
        setState("error");
      });
  }, [token]);

  return (
    <div className="min-h-screen grid place-items-center p-6 bg-grad-brand-anim">
      <div className="w-full max-w-sm card animate-grad-fade-up space-y-5">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-xl bg-grad-brand grid place-items-center shadow-grad-glow">
            <Sparkles size={20} className="text-white" />
          </div>
          <p className="text-lg font-bold tracking-tight text-primary">Oryza</p>
        </div>

        {state === "loading" && (
          <div className="flex items-center gap-2 text-sm text-secondary">
            <Loader2 size={16} className="animate-spin" /> Verifying your email…
          </div>
        )}

        {state === "ok" && (
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-emerald-500/15 ring-1 ring-inset ring-emerald-500/40 text-sm font-medium text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
            <span>Your email is verified. You&apos;re all set.</span>
          </div>
        )}

        {state === "error" && (
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-rose-500/15 ring-1 ring-inset ring-rose-500/40 text-sm font-medium text-rose-700 dark:text-rose-300">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <Link to="/login" className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-primary">
          <ArrowLeft size={14} /> Back to sign in
        </Link>
      </div>
    </div>
  );
}
