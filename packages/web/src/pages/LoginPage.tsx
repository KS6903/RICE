import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import api from "../services/api";
import { useAuthStore } from "../stores/authStore";
import { useThemeStore } from "../stores/themeStore";
import {
  Sparkles, ShieldCheck, Wifi, Building2, Sun, Moon, AlertCircle,
} from "lucide-react";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { setTokens, setUser } = useAuthStore();
  const theme = useThemeStore((s) => s.theme);
  const toggle = useThemeStore((s) => s.toggle);
  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const form = new FormData();
      form.append("username", username);
      form.append("password", password);
      const { data } = await api.post("/auth/login", form, {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
      setTokens(data.access_token, data.refresh_token);
      const { data: me } = await api.get("/auth/me");
      setUser(me);
      navigate(me.is_platform_admin ? "/admin" : "/");
    } catch (err: any) {
      setError(err.response?.data?.detail || "Invalid username or password.");
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
            <div className="h-11 w-11 rounded-xl bg-grad-brand grid place-items-center shadow-grad-glow">
              <Sparkles size={20} className="text-white" />
            </div>
            <p className="text-lg font-bold tracking-tight text-primary">Rice Mill System</p>
          </div>

          <h1 className="text-3xl font-bold tracking-tight text-primary">Welcome back</h1>
          <p className="mt-2 text-base text-secondary">
            Sign in to continue to your dashboard.
          </p>

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
                <button
                  type="button"
                  className="text-xs font-semibold text-muted hover:text-primary transition-colors"
                  tabIndex={-1}
                >
                  Forgot?
                </button>
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
          </form>

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
