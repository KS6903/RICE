import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import api from "../services/api";
import { useAuthStore } from "../stores/authStore";
import BrandLogo from "../components/BrandLogo";

export default function SignupPage() {
  const navigate = useNavigate();
  const { setTokens, setUser } = useAuthStore();
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

  const update = (k: keyof typeof form, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    setError("");
    if (form.password !== form.confirm) return setError("Passwords do not match.");
    if (form.password.length < 8) return setError("Password must be at least 8 characters.");
    setLoading(true);
    try {
      const { data } = await api.post("/auth/signup", {
        company_name: form.company_name,
        full_name: form.full_name,
        username: form.username,
        email: form.email,
        password: form.password,
        is_multi_branch: form.is_multi_branch,
      });
      setTokens(data.access_token, data.refresh_token);
      const { data: me } = await api.get("/auth/me");
      setUser(me);
      navigate("/");
    } catch (e: any) {
      setError(e.response?.data?.detail || "Signup failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-800 to-brand-900 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-8">
        <div className="text-center mb-6">
          <div className="flex items-center justify-center gap-2">
            <BrandLogo width={42} height={21} strokeWidth={6} className="text-amber-500" />
            <h1 className="text-2xl font-bold text-gray-900">Create your Rice Mill account</h1>
          </div>
          <p className="text-sm text-gray-500 mt-1">Free to start. No credit card required.</p>
        </div>

        <div className="flex gap-2 mb-6 justify-center">
          {[1, 2].map((s) => (
            <div key={s} className={`w-8 h-2 rounded-full ${step >= s ? "bg-brand-600" : "bg-gray-200"}`} />
          ))}
        </div>

        {step === 1 && (
          <div className="space-y-4">
            <h2 className="font-semibold text-gray-900">Company information</h2>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Company name *</label>
              <input className="input" value={form.company_name} onChange={(e) => update("company_name", e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Branch configuration</label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => update("is_multi_branch", false)}
                  className={`p-3 rounded-xl border-2 text-left text-sm ${!form.is_multi_branch ? "border-brand-600 bg-brand-50" : "border-gray-200 hover:border-gray-300"}`}
                >
                  <p className="font-semibold text-gray-900">Single location</p>
                  <p className="text-xs text-gray-500 mt-0.5">One mill site</p>
                </button>
                <button
                  type="button"
                  onClick={() => update("is_multi_branch", true)}
                  className={`p-3 rounded-xl border-2 text-left text-sm ${form.is_multi_branch ? "border-brand-600 bg-brand-50" : "border-gray-200 hover:border-gray-300"}`}
                >
                  <p className="font-semibold text-gray-900">Multiple branches</p>
                  <p className="text-xs text-gray-500 mt-0.5">Two or more mill sites</p>
                </button>
              </div>
            </div>
            <button
              onClick={() => setStep(2)}
              className="btn-primary w-full justify-center"
              disabled={!form.company_name.trim()}
            >
              Next →
            </button>
            <p className="text-center text-sm text-gray-500">
              Already have an account? <Link to="/login" className="text-brand-600 font-medium hover:underline">Sign in</Link>
            </p>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <h2 className="font-semibold text-gray-900">Owner account</h2>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Full name *</label>
              <input className="input" value={form.full_name} onChange={(e) => update("full_name", e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Username *</label>
                <input className="input" value={form.username} onChange={(e) => update("username", e.target.value)} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
                <input type="email" className="input" value={form.email} onChange={(e) => update("email", e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Password *</label>
                <input type="password" className="input" value={form.password} onChange={(e) => update("password", e.target.value)} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Confirm *</label>
                <input type="password" className="input" value={form.confirm} onChange={(e) => update("confirm", e.target.value)} />
              </div>
            </div>
            <p className="text-xs text-gray-500">Min. 8 characters.</p>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex gap-2">
              <button onClick={() => setStep(1)} className="btn-secondary flex-1 justify-center">← Back</button>
              <button
                onClick={submit}
                className="btn-primary flex-1 justify-center"
                disabled={loading || !form.full_name || !form.username || !form.email || !form.password}
              >
                {loading ? "Creating…" : "Create account"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
