import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { authService } from "../services/AuthService";
import { useAuthStore } from "../stores/authStore";
import { useThemeStore } from "../stores/themeStore";
import {
  Sparkles, Building2, Building, Sun, Moon, AlertCircle, ArrowRight, ArrowLeft, Check,
} from "lucide-react";
import { GoogleLogin } from "@react-oauth/google";

export default function SignupPage() {
  const navigate = useNavigate();
  const { setTokens, setUser } = useAuthStore();
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggle);
  const [step, setStep] = useState<1 | 2>(1);
  const [form, setForm] = useState({
    company_name: "",
    is_multi_branch: false,
    full_name: "",
    username: "",
    email: "",
    password: "",
    confirm: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const update = (k: keyof typeof form, v: string | boolean) =>
    setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    setError("");
    if (form.password !== form.confirm) return setError("Passwords do not match.");
    if (form.password.length < 8) return setError("Password must be at least 8 characters.");
    setLoading(true);
    try {
      const data = await authService.signup({
        company_name: form.company_name,
        full_name: form.full_name,
        username: form.username,
        email: form.email,
        password: form.password,
        is_multi_branch: form.is_multi_branch,
      });
      setTokens(data.access_token, data.refresh_token);
      const me = await authService.me();
      setUser(me);
      navigate("/");
    } catch (e: any) {
      setError(e.response?.data?.detail || "Signup failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSuccess = async (credentialResponse: any) => {
    setLoading(true);
    setError("");
    try {
      const data = await authService.loginGoogle(credentialResponse.credential, {
        company_name: form.company_name,
        is_multi_branch: form.is_multi_branch,
      });
      setTokens(data.access_token, data.refresh_token);
      const me = await authService.me();
      setUser(me);
      navigate("/");
    } catch (err: any) {
      setError(err.response?.data?.detail || "Google signup failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full grid lg:grid-cols-2 relative overflow-hidden">
      <button
        onClick={toggleTheme}
        className="absolute top-5 right-5 z-20 h-10 w-10 grid place-items-center rounded-xl glass text-secondary hover:text-primary transition-colors"
        aria-label="Toggle theme"
      >
        {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
      </button>

      <div className="relative hidden lg:flex flex-col justify-between p-12 overflow-hidden">
        <div className="absolute inset-0 pointer-events-none bg-grad-brand-anim opacity-95" aria-hidden />
        <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_bottom_left,_rgba(255,255,255,0.18),_transparent_60%)]" aria-hidden />
        <div className="absolute -top-32 -left-20 h-96 w-96 rounded-full bg-white/10 blur-3xl pointer-events-none animate-grad-float" aria-hidden />
        <div className="absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-violet-400/30 blur-3xl pointer-events-none" aria-hidden />

        <div className="relative flex items-center gap-3 text-white">
          <div className="h-11 w-11 rounded-xl bg-white/15 backdrop-blur-md grid place-items-center ring-1 ring-white/30">
            <Sparkles size={22} />
          </div>
          <div>
            <p className="text-lg font-bold tracking-tight">Rice Mill System</p>
            <p className="text-sm text-white/80">Pilipinas · ERP Platform</p>
          </div>
        </div>

        <div className="relative text-white max-w-md">
          <h2 className="text-4xl xl:text-5xl font-bold leading-[1.05] tracking-tight">
            Start free.
            <br />
            <span className="bg-gradient-to-r from-white via-cyan-200 to-emerald-200 bg-clip-text text-transparent">
              No card required.
            </span>
          </h2>
          <p className="mt-5 text-white text-base leading-relaxed">
            Set up your mill in under two minutes. We&rsquo;ll get your books, batches, and
            inventory online in one place.
          </p>

          <ul className="mt-10 space-y-3 text-base text-white font-medium">
            {[
              "Unlimited transactions on the free tier",
              "Offline-first — works at the mill site",
              "NFA & DA reports built in",
              "Cloud sync across all your devices",
            ].map((line) => (
              <li key={line} className="flex items-center gap-3">
                <div className="h-6 w-6 rounded-full bg-white/20 backdrop-blur-md grid place-items-center ring-1 ring-white/30">
                  <Check size={13} />
                </div>
                {line}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-sm text-white/75">
          © {new Date().getFullYear()} Rice Mill System · KS Productions
        </p>
      </div>

      <div className="flex items-center justify-center p-6 lg:p-12">
        <div className="w-full max-w-lg animate-grad-fade-up">
          <div className="lg:hidden flex items-center gap-3 mb-8">
            <div className="h-11 w-11 rounded-xl bg-grad-brand grid place-items-center shadow-grad-glow">
              <Sparkles size={20} className="text-white" />
            </div>
            <p className="text-lg font-bold tracking-tight text-primary">Rice Mill System</p>
          </div>

          <h1 className="text-3xl font-bold tracking-tight text-primary">
            Create your account
          </h1>
          <p className="mt-2 text-base text-secondary">
            Free to start. No credit card required.
          </p>

          {/* Step indicator */}
          <div className="mt-6 flex items-center gap-2">
            {[1, 2].map((s) => (
              <div
                key={s}
                className={`h-2 flex-1 rounded-full transition-all ${
                  step >= s ? "bg-grad-brand" : "bg-slate-300 dark:bg-slate-700"
                }`}
              />
            ))}
            <p className="ml-3 text-sm font-semibold text-secondary whitespace-nowrap">
              Step {step} of 2
            </p>
          </div>

          {step === 1 && (
            <div className="mt-8 space-y-5">
              <div>
                <label className="form-label">Company name *</label>
                <input
                  className="input"
                  value={form.company_name}
                  onChange={(e) => update("company_name", e.target.value)}
                  placeholder="ABC Rice Mill Corp."
                />
              </div>

              <div>
                <label className="form-label">Branch configuration</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => update("is_multi_branch", false)}
                    className={`relative p-4 rounded-2xl border-2 text-left transition-all ${
                      !form.is_multi_branch
                        ? "border-emerald-500 bg-emerald-500/10 shadow-grad-glow"
                        : "border-soft hover:border-soft-strong glass"
                    }`}
                  >
                    <Building size={20} className="text-emerald-600 dark:text-emerald-400 mb-2" />
                    <p className="font-bold text-primary">Single location</p>
                    <p className="text-sm text-secondary mt-0.5">One mill site</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => update("is_multi_branch", true)}
                    className={`relative p-4 rounded-2xl border-2 text-left transition-all ${
                      form.is_multi_branch
                        ? "border-emerald-500 bg-emerald-500/10 shadow-grad-glow"
                        : "border-soft hover:border-soft-strong glass"
                    }`}
                  >
                    <Building2 size={20} className="text-emerald-600 dark:text-emerald-400 mb-2" />
                    <p className="font-bold text-primary">Multi-branch</p>
                    <p className="text-sm text-secondary mt-0.5">Two or more sites</p>
                  </button>
                </div>
              </div>

              <button
                onClick={() => setStep(2)}
                className="btn-primary w-full"
                disabled={!form.company_name.trim()}
              >
                Continue
                <ArrowRight size={16} />
              </button>

              <p className="text-center text-base text-secondary">
                Already have an account?{" "}
                <Link
                  to="/login"
                  className="font-semibold text-grad-brand hover:opacity-80 transition-opacity"
                >
                  Sign in
                </Link>
              </p>
            </div>
          )}

          {step === 2 && (
            <div className="mt-8 space-y-4">
              <div>
                <label className="form-label">Full name *</label>
                <input
                  className="input"
                  value={form.full_name}
                  onChange={(e) => update("full_name", e.target.value)}
                  placeholder="Juan Dela Cruz"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="form-label">Username *</label>
                  <input
                    className="input"
                    value={form.username}
                    onChange={(e) => update("username", e.target.value)}
                    placeholder="juandc"
                  />
                </div>
                <div>
                  <label className="form-label">Email *</label>
                  <input
                    type="email"
                    className="input"
                    value={form.email}
                    onChange={(e) => update("email", e.target.value)}
                    placeholder="you@company.com"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="form-label">Password *</label>
                  <input
                    type="password"
                    className="input"
                    value={form.password}
                    onChange={(e) => update("password", e.target.value)}
                    placeholder="••••••••"
                  />
                </div>
                <div>
                  <label className="form-label">Confirm *</label>
                  <input
                    type="password"
                    className="input"
                    value={form.confirm}
                    onChange={(e) => update("confirm", e.target.value)}
                    placeholder="••••••••"
                  />
                </div>
              </div>
              <p className="text-sm font-medium text-muted">Minimum 8 characters.</p>

              {error && (
                <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-rose-500/15 ring-1 ring-inset ring-rose-500/40 text-sm font-medium text-rose-700 dark:text-rose-300">
                  <AlertCircle size={16} className="mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => setStep(1)}
                  className="btn-secondary flex-1"
                >
                  <ArrowLeft size={16} />
                  Back
                </button>
                <button
                  onClick={submit}
                  className="btn-primary flex-1"
                  disabled={
                    loading ||
                    !form.full_name ||
                    !form.username ||
                    !form.email ||
                    !form.password
                  }
                >
                  {loading ? "Creating…" : "Create account"}
                  {!loading && <ArrowRight size={16} />}
                </button>
              </div>

              <div className="relative flex items-center py-2 mt-4">
                <div className="flex-grow border-t border-slate-200 dark:border-slate-800"></div>
                <span className="flex-shrink-0 mx-4 text-sm text-secondary">or</span>
                <div className="flex-grow border-t border-slate-200 dark:border-slate-800"></div>
              </div>

              <div className="flex justify-center w-full [&>div]:w-full mt-4">
                <GoogleLogin
                  onSuccess={handleGoogleSuccess}
                  onError={() => setError("Google signup failed.")}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
