import { useEffect, useState } from "react";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import { authService } from "../services/AuthService";
import { useAuthStore } from "../stores/authStore";
import PasswordInput from "../components/PasswordInput";
import {
  ShieldCheck,
  Wifi,
  Building2,
  AlertCircle,
  Clock,
  ArrowLeft,
  LifeBuoy,
} from "lucide-react";
import { GoogleLogin } from "@react-oauth/google";
import { googleSignInEnabled } from "../utils/googleSignIn";
import riceLogo from "../assets/Rice_Logo.svg";
import { enterApp, safeNext, withNext } from "../utils/next";
import { serverUnreachableMessage, warmUpApi } from "../services/warmUp";
import { useAfterDelay } from "../hooks/useAfterDelay";
import ServerWakingHint from "../components/ServerWakingHint";

export default function LoginPage() {
  // Boot a sleeping API while the person types, not after they press Sign in.
  useEffect(() => warmUpApi(), []);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  // Set when the account is permanently locked (code "account_locked") — only a
  // password reset frees it, so we steer the user there.
  const [lockedOut, setLockedOut] = useState(false);
  // Set when the account is locked for any reason, timed or permanent: that is when
  // the way back in is a temporary password, from the Boss or (for a Boss) the admin.
  const [locked, setLocked] = useState(false);
  const [help, setHelp] = useState<{ state: "idle" | "sending" | "sent" | "error"; text: string }>({
    state: "idle",
    text: "",
  });
  const [loading, setLoading] = useState(false);
  // A sign-in still going after 3 seconds is almost always the server waking up.
  const slow = useAfterDelay(loading, 3000);
  // Two-step MFA login: when set, the password step passed and we're waiting
  // for the authenticator code.
  const [mfaChallenge, setMfaChallenge] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [useBackupCode, setUseBackupCode] = useState(false);
  const { setTokens, setUser } = useAuthStore();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Set by useIdleLogout when it signs the user out for inactivity.
  const idleSignedOut = searchParams.get("reason") === "idle";
  // Where to go once signed in, if it's a page that may ask (/retrieve-data).
  const next = safeNext(searchParams);
  // Prefer real history so the user lands where they came from; fall back to the
  // marketing home when login was opened directly (deep link, new tab).
  const handleBack = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate("/");
  };

  // The button stays busy on success: the page is being replaced by the app.
  const finishLogin = async (data: any) => {
    setTokens(data?.access_token, data?.refresh_token);
    const me = await authService.me();
    setUser(me);
    enterApp(me.is_platform_admin ? "/admin" : (next ?? "/"), navigate);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setLockedOut(false);
    setLocked(false);
    setHelp({ state: "idle", text: "" });
    try {
      const data = await authService.login(username, password);
      if (data.mfa_required) {
        setMfaChallenge(data.challenge_token);
        setLoading(false);
        return;
      }
      await finishLogin(data);
    } catch (err: any) {
      setLoading(false);
      setError(
        serverUnreachableMessage(err) ??
          (err.response?.data?.detail || "Invalid username or password."),
      );
      // A permanent lockout can only be cleared by resetting the password.
      const code = err.response?.data?.code;
      setLockedOut(code === "account_locked");
      setLocked(code === "account_locked" || code === "account_locked_temporary");
    }
  };

  // A locked-out Boss asks the platform admin for a temporary password. The server
  // answers the same whatever the username is, so say only what it said.
  const askTheAdmin = async () => {
    setHelp({ state: "sending", text: "" });
    try {
      const res = await authService.requestLockoutHelp(username.trim());
      setHelp({ state: "sent", text: res.message });
    } catch (err: any) {
      setHelp({
        state: "error",
        text: err.response?.data?.detail || "Couldn't send that. Try again in a little while.",
      });
    }
  };

  const handleMfaVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mfaChallenge) return;
    setLoading(true);
    setError("");
    try {
      const data = await authService.mfaVerify(mfaChallenge, mfaCode.trim());
      await finishLogin(data);
    } catch (err: any) {
      setLoading(false);
      const status = err.response?.status;
      setError(
        serverUnreachableMessage(err) ??
          (err.response?.data?.detail || "Invalid authentication code."),
      );
      // An expired/consumed challenge means starting over from the password step.
      if (status === 401 && err.response?.data?.detail?.includes("challenge")) {
        setMfaChallenge(null);
        setMfaCode("");
      }
    }
  };

  const handleGoogleSuccess = async (credentialResponse: any) => {
    setLoading(true);
    setError("");
    try {
      const data = await authService.loginGoogle(credentialResponse.credential);
      await finishLogin(data);
    } catch (err: any) {
      setLoading(false);
      setError(
        serverUnreachableMessage(err) ?? (err.response?.data?.detail || "Google login failed."),
      );
    }
  };

  return (
    <div className="min-h-screen w-full grid lg:grid-cols-2 relative overflow-hidden">
      {/* LEFT — marketing */}
      <div className="relative hidden lg:flex flex-col justify-between p-12 overflow-hidden">
        <div
          className="absolute inset-0 pointer-events-none bg-grad-brand-anim opacity-95"
          aria-hidden
        />
        <div
          className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_top_right,_rgba(255,255,255,0.18),_transparent_60%)]"
          aria-hidden
        />
        {/* Gradients, not blur filters, and still: see SignupPage. */}
        <div
          className="absolute -bottom-32 -left-32 h-96 w-96 rounded-full bg-[radial-gradient(closest-side,rgba(255,255,255,0.14),transparent)] pointer-events-none"
          aria-hidden
        />
        <div
          className="absolute -top-32 -right-20 h-96 w-96 rounded-full bg-[radial-gradient(closest-side,rgba(167,139,250,0.4),transparent)] pointer-events-none"
          aria-hidden
        />

        <div className="relative flex items-center gap-3 text-white">
          <Link to="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
            <div className="h-12 w-12 rounded-xl bg-white/15 grid place-items-center ring-1 ring-white/30">
              <img
                src={riceLogo}
                alt="Oraiza"
                className="h-full w-full object-contain brightness-0 invert"
              />
            </div>
            <p className="text-lg font-bold tracking-tight">Oraiza</p>
          </Link>
        </div>

        <div className="relative text-white max-w-md">
          <h2 className="text-4xl xl:text-5xl font-bold leading-[1.05] tracking-tight">
            Run your mill
            <br />
            <span className="bg-gradient-to-r from-white via-cyan-200 to-emerald-200 bg-clip-text text-transparent">
              like the future.
            </span>
          </h2>
          <p className="mt-5 text-white text-base leading-relaxed">
            The modern ERP built for Philippine rice millers. Track palay, milling, inventory, and
            P&amp;L — online or offline, on any device.
          </p>

          <div className="mt-10 grid gap-3">
            {[
              { icon: Wifi, label: "Works offline · syncs when you reconnect" },
              { icon: ShieldCheck, label: "NFA & DA-ready compliance reports" },
              { icon: Building2, label: "Single or multi-branch out of the box" },
            ].map(({ icon: Icon, label }) => (
              <div key={label} className="flex items-center gap-3 text-base text-white font-medium">
                <div className="h-9 w-9 rounded-lg bg-white/15 grid place-items-center ring-1 ring-white/25">
                  <Icon size={16} />
                </div>
                {label}
              </div>
            ))}
          </div>
        </div>

        <p className="relative text-sm text-white/75">
          © {new Date().getFullYear()} Oraiza by K Systematics
        </p>
      </div>

      {/* RIGHT — form */}
      <div className="relative flex items-center justify-center p-6 lg:p-12">
        {/* Back — anchored to the form (white) side.
            On desktop it sits level with the Oraiza logo: the logo row's centre is
            72px down (p-12 + a 48px logo), so this 44px pill starts at 50px. */}
        <button
          type="button"
          onClick={handleBack}
          className="btn-back absolute top-5 lg:top-[3.125rem] left-5 z-20"
        >
          <span className="btn-back-icon" aria-hidden="true">
            <ArrowLeft size={18} />
            <ArrowLeft size={18} />
          </span>
          Back
        </button>

        <div className="w-full max-w-sm animate-grad-fade-up">
          <div className="lg:hidden flex items-center gap-3 mb-8">
            <Link
              to="/"
              className="h-12 w-12 rounded-xl bg-grad-brand grid place-items-center shadow-grad-glow"
            >
              <img
                src={riceLogo}
                alt="Oraiza"
                className="h-full w-full object-contain brightness-0 invert"
              />
            </Link>
            <p className="text-lg font-bold tracking-tight text-primary">Oraiza</p>
          </div>

          <h1 className="text-3xl font-bold tracking-tight text-primary">
            {mfaChallenge ? "Two-factor authentication" : "Welcome back"}
          </h1>
          <p className="mt-2 text-base text-secondary">
            {mfaChallenge
              ? useBackupCode
                ? "Enter one of your saved backup codes."
                : "Enter the 6-digit code from your authenticator app."
              : "Sign in to continue to your dashboard."}
          </p>

          {idleSignedOut && !mfaChallenge && (
            <div className="mt-6 flex items-start gap-2 px-3 py-2.5 rounded-xl bg-sky-500/15 ring-1 ring-inset ring-sky-500/40 text-sm font-medium text-sky-700 dark:text-sky-300">
              <Clock size={16} className="mt-0.5 shrink-0" />
              <span>You were signed out due to inactivity. Please sign in again.</span>
            </div>
          )}

          {mfaChallenge ? (
            <form onSubmit={handleMfaVerify} className="mt-8 space-y-5">
              <div>
                <label className="form-label">
                  {useBackupCode ? "Backup code" : "Authentication code"}
                </label>
                {useBackupCode ? (
                  <input
                    className="input text-center font-mono"
                    value={mfaCode}
                    onChange={(e) => setMfaCode(e.target.value.slice(0, 30))}
                    autoComplete="one-time-code"
                    placeholder="xxxx-xxxx-xxxx-xxxx"
                    autoFocus
                    required
                  />
                ) : (
                  <input
                    className="input text-center tracking-[0.5em] text-lg"
                    value={mfaCode}
                    onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="••••••"
                    autoFocus
                    required
                  />
                )}
              </div>

              {error && (
                <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-rose-500/15 ring-1 ring-inset ring-rose-500/40 text-sm font-medium text-rose-700 dark:text-rose-300">
                  <AlertCircle size={16} className="mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                className="btn-primary w-full"
                disabled={loading || mfaCode.replace(/\s/g, "").length < 6}
              >
                {loading ? "Verifying…" : "Verify"}
              </button>
              {slow && <ServerWakingHint />}

              <button
                type="button"
                className="w-full text-sm font-semibold text-muted hover:text-primary transition-colors"
                onClick={() => {
                  setUseBackupCode((v) => !v);
                  setMfaCode("");
                  setError("");
                }}
              >
                {useBackupCode ? "Use authenticator app instead" : "Use a backup code instead"}
              </button>

              <button
                type="button"
                className="w-full text-sm font-semibold text-muted hover:text-primary transition-colors"
                onClick={() => {
                  setMfaChallenge(null);
                  setMfaCode("");
                  setUseBackupCode(false);
                  setError("");
                }}
              >
                ← Back to sign in
              </button>
            </form>
          ) : (
            <form onSubmit={handleLogin} className="mt-8 space-y-5">
              <div>
                <label className="form-label">Username</label>
                <input
                  className="input"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  placeholder="your.username"
                  required
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="form-label" style={{ marginBottom: 0 }}>
                    Password
                  </label>
                  <Link
                    to="/forgot-password"
                    className="text-xs font-semibold text-muted hover:text-primary transition-colors"
                  >
                    Forgot?
                  </Link>
                </div>
                <PasswordInput
                  className="input"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  required
                />
              </div>

              {error && (
                <div className="flex flex-col gap-2 px-3 py-2.5 rounded-xl bg-rose-500/15 ring-1 ring-inset ring-rose-500/40 text-sm font-medium text-rose-700 dark:text-rose-300">
                  <div className="flex items-start gap-2">
                    <AlertCircle size={16} className="mt-0.5 shrink-0" />
                    <span>{error}</span>
                  </div>
                  {lockedOut && (
                    <Link
                      to="/forgot-password"
                      className="self-start font-semibold underline underline-offset-2 hover:opacity-80"
                    >
                      Reset your password to unlock →
                    </Link>
                  )}
                </div>
              )}

              {error && locked && (
                <section
                  aria-label="Locked out?"
                  className="space-y-3 rounded-xl bg-slate-500/10 px-3 py-3 text-sm text-secondary ring-1 ring-inset ring-slate-500/30"
                >
                  <p className="flex items-center gap-2 font-semibold text-primary">
                    <LifeBuoy size={16} aria-hidden /> Locked out?
                  </p>
                  <p>
                    <strong>Employee:</strong> ask your Boss to give you a temporary password from
                    the Users page.
                  </p>
                  <div className="space-y-2">
                    <p>
                      <strong>Boss:</strong> email the admin, who will give you a temporary
                      password.
                    </p>
                    <button
                      type="button"
                      onClick={askTheAdmin}
                      disabled={
                        !username.trim() || help.state === "sending" || help.state === "sent"
                      }
                      className="btn-secondary w-full"
                    >
                      {help.state === "sending" ? "Sending…" : "Email the admin"}
                    </button>
                    {(help.state === "sent" || help.state === "error") && (
                      <p
                        role={help.state === "error" ? "alert" : "status"}
                        className={
                          help.state === "error"
                            ? "font-semibold text-rose-600 dark:text-rose-400"
                            : "font-semibold text-emerald-700 dark:text-emerald-400"
                        }
                      >
                        {help.text}
                      </p>
                    )}
                  </div>
                </section>
              )}

              <button type="submit" className="btn-primary w-full" disabled={loading || lockedOut}>
                {loading ? "Signing in…" : "Sign in"}
              </button>
              {slow && <ServerWakingHint />}

              {/* Google sign-in only when it is set up: see googleSignIn.ts. */}
              {googleSignInEnabled() && (
                <>
                  <div className="relative flex items-center py-2">
                    <div className="flex-grow border-t border-slate-200 dark:border-slate-800"></div>
                    <span className="flex-shrink-0 mx-4 text-sm text-secondary">or</span>
                    <div className="flex-grow border-t border-slate-200 dark:border-slate-800"></div>
                  </div>

                  {/* Custom Google button — visual layer + invisible GIS overlay */}
                  <div className="relative w-full group cursor-pointer rounded-xl">
                    {/* Visual button — pointer-events: none, overlay captures all clicks */}
                    <div className="pointer-events-none select-none w-full h-11 flex items-center justify-center gap-3 rounded-xl border border-soft bg-white dark:bg-slate-800/60 text-sm font-semibold text-primary shadow-sm group-hover:bg-slate-50 dark:group-hover:bg-slate-800 group-active:scale-[0.98] transition-all">
                      <svg
                        viewBox="0 0 24 24"
                        width="18"
                        height="18"
                        xmlns="http://www.w3.org/2000/svg"
                        className="shrink-0"
                      >
                        <path
                          fill="#4285F4"
                          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                        />
                        <path
                          fill="#34A853"
                          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                        />
                        <path
                          fill="#FBBC05"
                          d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
                        />
                        <path
                          fill="#EA4335"
                          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                        />
                      </svg>
                      Continue with Google
                    </div>
                    {/* Invisible GIS button — real clickable element */}
                    <div
                      className="absolute inset-0 overflow-hidden opacity-[0.01] rounded-xl"
                      aria-hidden="true"
                    >
                      <GoogleLogin
                        onSuccess={handleGoogleSuccess}
                        onError={() => setError("Google login failed.")}
                        useOneTap
                        width={400}
                        size="large"
                      />
                    </div>
                  </div>
                </>
              )}
            </form>
          )}

          <p className="mt-8 text-center text-base text-secondary">
            New to Oraiza?{" "}
            <Link
              to={withNext("/signup", next)}
              className="font-semibold text-grad-brand hover:opacity-80 transition-opacity"
            >
              Create an account →
            </Link>
          </p>

          <nav className="mt-6 flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-muted">
            <Link to="/legal/terms" className="link">
              Terms
            </Link>
            <Link to="/legal/privacy" className="link">
              Privacy
            </Link>
          </nav>
        </div>
      </div>
    </div>
  );
}
