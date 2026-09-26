import { useState } from "react";
import { Link } from "react-router-dom";
import { FileText, AlertCircle, LogOut, Check } from "lucide-react";
import { legalService } from "../services/LegalService";
import { authService } from "../services/AuthService";
import { useAuthStore } from "../stores/authStore";

/** Mandatory re-acceptance screen.
 *
 *  Shown in place of the whole app when /me reports
 *  `legal_acceptance_required`: either the account has no acceptance on record,
 *  or the published agreement bundle is newer than the version they accepted.
 *
 *  Two things make this worth a blocking screen rather than a banner. Continued
 *  use is a weak form of consent, and section 18 of the Terms promises an
 *  explicit re-acceptance, so the promise has to be kept. Logging out stays
 *  available, because a gate with no exit is coercion, not consent.
 */
export default function LegalAcceptanceGate() {
  const logout = useAuthStore((s) => s.logout);
  const [checked, setChecked] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const accept = async () => {
    setError("");
    setLoading(true);
    try {
      await legalService.accept();
      // Refetching /me clears legal_acceptance_required, and the gate lifts.
      useAuthStore.getState().setUser(await authService.me());
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Could not record your acceptance. Try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen grid place-items-center p-6 bg-grad-brand-anim">
      <div className="w-full max-w-md card animate-grad-fade-up space-y-5">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-xl bg-grad-brand grid place-items-center shadow-grad-glow">
            <FileText size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-primary">Our terms have been updated</h1>
            <p className="text-sm text-secondary">Please review and accept to continue.</p>
          </div>
        </div>

        <p className="text-sm text-secondary leading-relaxed">
          Take a moment to read these before you accept. They cover what Oryza is and is not, how we
          handle personal information under the Data Privacy Act, and the limit on our liability.
        </p>

        <ul className="space-y-2">
          {[
            { key: "terms", label: "Terms of Service" },
            { key: "privacy", label: "Privacy Policy" },
            { key: "dpa", label: "Data Processing Addendum" },
            { key: "aup", label: "Acceptable Use Policy" },
          ].map((d) => (
            <li key={d.key}>
              <Link
                to={`/legal/${d.key}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl glass hover:border-soft-strong transition-colors"
              >
                <span className="text-sm font-medium text-primary">{d.label}</span>
                <span className="text-xs text-muted">Read</span>
              </Link>
            </li>
          ))}
        </ul>

        <label className="flex items-start gap-3 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
            className="mt-0.5 h-5 w-5 shrink-0 rounded accent-emerald-500"
            data-testid="legal-gate-checkbox"
          />
          <span className="text-sm text-secondary leading-snug">
            I have read and accept the Terms of Service, Privacy Policy, Data Processing Addendum
            and Acceptable Use Policy, and I am authorised to accept them for my company.
          </span>
        </label>

        {error && (
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-rose-500/15 ring-1 ring-inset ring-rose-500/40 text-sm font-medium text-rose-700 dark:text-rose-300">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <button
          onClick={accept}
          disabled={!checked || loading}
          className="btn-primary w-full"
          data-testid="legal-gate-accept"
        >
          {loading ? "Saving…" : "Accept and continue"}
          {!loading && <Check size={16} />}
        </button>

        <button onClick={() => logout()} className="btn-ghost w-full text-sm">
          <LogOut size={15} />
          Sign out instead
        </button>
      </div>
    </div>
  );
}
