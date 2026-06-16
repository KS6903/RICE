import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { authService } from "../services/AuthService";
import { useAuthStore } from "../stores/authStore";
import { useThemeStore } from "../stores/themeStore";
import {
  ShieldCheck, Wifi, Building2, Sun, Moon, AlertCircle,
} from "lucide-react";
import { GoogleLogin } from "@react-oauth/google";
import riceLogo from "../assets/Rice_Logo.svg";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  // Two-step MFA login: when set, the password step passed and we're waiting
  // for the authenticator code.
  const [mfaChallenge, setMfaChallenge] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [useBackupCode, setUseBackupCode] = useState(false);
  const { setTokens, setUser } = useAuthStore();
  const theme = useThemeStore((s) => s.theme);
  const toggle = useThemeStore((s) => s.toggle);
  const navigate = useNavigate();

  const finishLogin = async (data: any) => {
    setTokens(data.access_token, data.refresh_token);
    const me = await authService.me();
    setUser(me);
    navigate(me.is_platform_admin ? "/admin" : "/");
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const data = await authService.login(username, password);
      if (data.mfa_required) {
        setMfaChallenge(data.challenge_token);
        return;
      }
      await finishLogin(data);
    } catch (err: any) {
      setError(err.response?.data?.detail || "Invalid username or password.");
    } finally {
      setLoading(false);
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
      const status = err.response?.status;
      setError(err.response?.data?.detail || "Invalid authentication code.");
      // An expired/consumed challenge means starting over from the password step.
      if (status === 401 && err.response?.data?.detail?.includes("challenge")) {
        setMfaChallenge(null);
        setMfaCode("");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSuccess = async (credentialResponse: any) => {
    setLoading(true);
    setError("");
    try {
      const data = await authService.loginGoogle(credentialResponse.credential);
      await finishLogin(data);
    } catch (err: any) {
      setError(err.response?.data?.detail || "Google login failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full grid lg:grid-cols-2 relative overflow-hidden">
      <button
        onClick={toggle}
        className="absolute top-5 right-5 z-20 h-10 w-10 grid place-items-center rounded-xl glass text-secondary hover:text-primary transition-colors"
        aria-label="Toggle theme"
      >
        {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
      </button>

      {/* LEFT — marketing */}
      <div className="relative hidden lg:flex flex-col justify-between p-12 overflow-hidden">
        <div className="absolute inset-0 pointer-events-none bg-grad-brand-anim opacity-95" aria-hidden />
        <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_top_right,_rgba(255,255,255,0.18),_transparent_60%)]" aria-hidden />
        <div className="absolute -bottom-32 -left-32 h-96 w-96 rounded-full bg-white/10 blur-3xl pointer-events-none animate-grad-float" aria-hidden />
        <div className="absolute -top-32 -right-20 h-96 w-96 rounded-full bg-violet-400/30 blur-3xl pointer-events-none" aria-hidden />

        <div className="relative flex items-center gap-3 text-white">
          <Link to="/" className="h-12 w-12 rounded-xl bg-white/15 backdrop-blur-md grid place-items-center ring-1 ring-white/30">
            <img src={riceLogo} alt="Rice Mill" className="h-full w-full object-contain brightness-0 invert" />
          </Link>
          <div>
            <p className="text-lg font-bold tracking-tight">Rice Mill System</p>
            <p className="text-sm text-white/80">Pilipinas · ERP Platform</p>
          </div>
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
            The modern ERP built for Philippine rice millers. Track palay, milling,
            inventory, and P&amp;L — online or offline, on any device.
          </p>

          <div className="mt-10 grid gap-3">
            {[
              { icon: Wifi, label: "Works offline · syncs when you reconnect" },
              { icon: ShieldCheck, label: "NFA & DA-ready compliance reports" },
              { icon: Building2, label: "Single or multi-branch out of the box" },
            ].map(({ icon: Icon, label }) => (
              <div key={label} className="flex items-center gap-3 text-base text-white font-medium">
                <div className="h-9 w-9 rounded-lg bg-white/15 backdrop-blur-md grid place-items-center ring-1 ring-white/25">
                  <Icon size={16} />
                </div>
                {label}
              </div>
            ))}
          </div>
        </div>

        <p className="relative text-sm text-white/75">
          © {new Date().getFullYear()} Rice Mill System · KS Productions
        </p>
      </div>

      {/* RIGHT — form */}
      <div className="flex items-center justify-center p-6 lg:p-12">
        <div className="w-full max-w-sm animate-grad-fade-up">
          <div className="lg:hidden flex items-center gap-3 mb-8">
            <Link to="/" className="h-12 w-12 rounded-xl bg-grad-brand grid place-items-center shadow-grad-glow">
              <img src={riceLogo} alt="Rice Mill" className="h-full w-full object-contain brightness-0 invert" />
            </Link>
            <p className="text-lg font-bold tracking-tight text-primary">Rice Mill System</p>
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

          {mfaChallenge ? (
            <form onSubmit={handleMfaVerify} className="mt-8 space-y-5">
              <div>
                <label className="form-label">{useBackupCode ? "Backup code" : "Authentication code"}</label>
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

              <button type="submit" className="btn-primary w-full" disabled={loading || mfaCode.replace(/\s/g, "").length < 6}>
                {loading ? "Verifying…" : "Verify"}
              </button>

              <button
                type="button"
                className="w-full text-sm font-semibold text-muted hover:text-primary transition-colors"
                onClick={() => { setUseBackupCode((v) => !v); setMfaCode(""); setError(""); }}
              >
                {useBackupCode ? "Use authenticator app instead" : "Use a backup code instead"}
              </button>

              <button
                type="button"
                className="w-full text-sm font-semibold text-muted hover:text-primary transition-colors"
                onClick={() => { setMfaChallenge(null); setMfaCode(""); setUseBackupCode(false); setError(""); }}
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
                <label className="form-label" style={{ marginBottom: 0 }}>Password</label>
                <Link
                  to="/forgot-password"
                  className="text-xs font-semibold text-muted hover:text-primary transition-colors"
                >
                  Forgot?
                </Link>
              </div>
              <input
                type="password"
                className="input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
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

            <button
              type="submit"
              className="btn-primary w-full"
              disabled={loading}
            >
              {loading ? "Signing in…" : "Sign in"}
            </button>

            <div className="relative flex items-center py-2">
              <div className="flex-grow border-t border-slate-200 dark:border-slate-800"></div>
              <span className="flex-shrink-0 mx-4 text-sm text-secondary">or</span>
              <div className="flex-grow border-t border-slate-200 dark:border-slate-800"></div>
            </div>

            <div className="flex justify-center w-full [&>div]:w-full">
              <GoogleLogin
                onSuccess={handleGoogleSuccess}
                onError={() => setError("Google login failed.")}
                useOneTap
              />
            </div>
          </form>
          )}

          <p className="mt-8 text-center text-base text-secondary">
            New to Rice Mill System?{" "}
            <Link
              to="/signup"
              className="font-semibold text-grad-brand hover:opacity-80 transition-opacity"
            >
              Create an account →
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
