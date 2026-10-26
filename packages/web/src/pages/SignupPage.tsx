import { useEffect, useRef, useState } from "react";
import { useNavigate, useLocation, useSearchParams, Link } from "react-router-dom";
import { authService } from "../services/AuthService";
import { useAuthStore } from "../stores/authStore";
import PasswordInput from "../components/PasswordInput";
import { Building2, Building, AlertCircle, ArrowRight, ArrowLeft, Check } from "lucide-react";
import { GoogleLogin } from "@react-oauth/google";
import { googleSignInEnabled } from "../utils/googleSignIn";
import riceLogo from "../assets/Rice_Logo.svg";
import { legalService } from "../services/LegalService";
import TurnstileWidget, { type TurnstileHandle } from "../components/TurnstileWidget";
import { enterApp, safeNext, withNext } from "../utils/next";
import { serverUnreachableMessage, warmUpApi } from "../services/warmUp";
import AuthLoadingScreen from "../components/AuthLoadingScreen";
import { t } from "../i18n";
import { tx } from "../i18n/tx";

// A new account's username, email and password are never a saved one, so no
// browser or password manager may fill them in. "off" keeps Chrome's autofill
// out of the text fields. For passwords Chrome ignores "off" but won't fill a
// saved password into "new-password". The data- attributes ask 1Password,
// LastPass, Bitwarden and Dashlane to stay out too.
const NO_AUTOFILL = {
  "data-1p-ignore": "true",
  "data-lpignore": "true",
  "data-bwignore": "true",
  "data-form-type": "other",
};

const TICK_TERMS = t("Tick the box to accept the Terms of Service and policies first.");

export default function SignupPage() {
  useEffect(() => warmUpApi(), []);
  const navigate = useNavigate();
  const location = useLocation();
  // Where to go once the account exists, if it's a page that may ask (/retrieve-data).
  const [searchParams] = useSearchParams();
  const next = safeNext(searchParams);
  const { setTokens, setUser } = useAuthStore();
  const [step, setStep] = useState<1 | 2>(1);
  const [form, setForm] = useState({
    company_name: "",
    invite_code: "",
    is_multi_branch: false,
    full_name: "",
    username: "",
    email: "",
    password: "",
    confirm: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  // The version on screen travels with the acceptance. If the terms change
  // while this tab is open the server rejects the stale version rather than
  // silently binding the user to text they never saw.
  const [agreementVersion, setAgreementVersion] = useState<string | null>(null);
  // null until the server answers, and neither the invite field nor the bot
  // check shows before then: the invite field used to show at first and then
  // vanish when sign-up turned out to be open.
  const [config, setConfig] = useState<{
    invite_required: boolean;
    turnstile_site_key: string | null;
  } | null>(null);
  const [turnstileToken, setTurnstileToken] = useState("");
  const turnstile = useRef<TurnstileHandle>(null);

  useEffect(() => {
    let cancelled = false;
    authService
      .signupConfig()
      .then((c) => {
        if (!cancelled) setConfig(c);
      })
      .catch(() => {
        // Ask for the invite code: the server decides either way.
        if (!cancelled) setConfig({ invite_required: true, turnstile_site_key: null });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    legalService
      .index()
      .then((i) => {
        if (!cancelled) setAgreementVersion(i.agreement_version);
      })
      .catch(() => {
        /* The server re-checks acceptance either way; a failed lookup just
           means we send no version and it validates the flag alone. */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const update = (k: keyof typeof form, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  // One back button for the whole flow: step 2 returns to step 1, and step 1
  // leaves — to wherever the visitor came from, or to the home page when they
  // opened this page directly and there is nothing to go back to.
  const goBack = () => {
    if (step === 2) return setStep(1);
    if (location.key !== "default") navigate(-1);
    else navigate("/");
  };

  const submit = async () => {
    setError("");
    if (form.password !== form.confirm) return setError(t("Passwords do not match."));
    if (form.password.length < 8) return setError(t("Password must be at least 8 characters."));
    if (!acceptedTerms) return setError(TICK_TERMS);
    setLoading(true);
    try {
      const data = await authService.signup({
        company_name: form.company_name,
        ...(form.invite_code.trim() ? { invite_code: form.invite_code.trim() } : {}),
        full_name: form.full_name,
        username: form.username,
        email: form.email,
        password: form.password,
        is_multi_branch: form.is_multi_branch,
        // The server refuses the signup without it, so an account can't exist
        // with no acceptance on record.
        accepted_terms: acceptedTerms,
        ...(agreementVersion ? { agreement_version: agreementVersion } : {}),
        ...(turnstileToken ? { turnstile_token: turnstileToken } : {}),
      });
      setTokens(data?.access_token, data?.refresh_token);
      const me = await authService.me();
      setUser(me);
      // The loading page stays up: the page is being replaced by the app.
      enterApp(next ?? "/", navigate);
    } catch (e: any) {
      setLoading(false);
      setError(
        serverUnreachableMessage(e) ??
          (e.response?.data?.detail || t("Signup failed. Please try again.")),
      );
      // A Turnstile token works once: get a fresh one for the next try.
      turnstile.current?.reset();
    }
  };

  const handleGoogleSuccess = async (credentialResponse: any) => {
    if (!acceptedTerms) return setError(TICK_TERMS);
    setLoading(true);
    setError("");
    try {
      const data = await authService.loginGoogle(credentialResponse.credential, {
        company_name: form.company_name,
        ...(form.invite_code.trim() ? { invite_code: form.invite_code.trim() } : {}),
        is_multi_branch: form.is_multi_branch,
        accepted_terms: acceptedTerms,
        ...(agreementVersion ? { agreement_version: agreementVersion } : {}),
      });
      setTokens(data?.access_token, data?.refresh_token);
      const me = await authService.me();
      setUser(me);
      enterApp(next ?? "/", navigate);
    } catch (err: any) {
      setLoading(false);
      setError(
        serverUnreachableMessage(err) ?? (err.response?.data?.detail || t("Google signup failed.")),
      );
    }
  };

  return (
    // Desktop: exactly one screen tall, so the page itself never scrolls; only
    // the form panel would, in a window too short to fit it. Phones keep normal
    // scrolling so the on-screen keyboard can't hide the field being typed in.
    <div className="auth-viewport auth-fixed w-full grid lg:grid-cols-2 lg:grid-rows-[minmax(0,1fr)] relative overflow-hidden">
      {/* A loading page while the account is made: see LoginPage. */}
      {loading && <AuthLoadingScreen label={t("Creating your account…")} />}
      {/* Back — shares LoginPage's .btn-back component (index.css). Positioned
          just right of the seam on desktop, level with the Oraiza logo (p-12 +
          a 44px logo, the same height as this pill, so top-12 lines them up);
          this button isn't nested in the scrollable form column the way
          LoginPage's is — nesting it would scroll it away in a short window. */}
      <button
        type="button"
        onClick={goBack}
        className="btn-back absolute top-5 left-5 lg:top-12 lg:left-[calc(50%+1.25rem)] z-20"
      >
        <span className="btn-back-icon" aria-hidden="true">
          <ArrowLeft size={18} />
          <ArrowLeft size={18} />
        </span>
        {t("Back")}
      </button>

      <div className="relative hidden lg:flex flex-col justify-between p-12 overflow-hidden">
        <div
          className="absolute inset-0 pointer-events-none bg-grad-brand-anim opacity-95"
          aria-hidden
        />
        <div
          className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_bottom_left,_rgba(255,255,255,0.18),_transparent_60%)]"
          aria-hidden
        />
        {/* Soft glows drawn as gradients, not blur filters, and nothing here
            moves: without GPU drawing, blurs and endless animation made
            typing in the form lag (index.css, .bg-grad-brand-anim). */}
        <div
          className="absolute -top-32 -left-20 h-96 w-96 rounded-full bg-[radial-gradient(closest-side,rgba(255,255,255,0.14),transparent)] pointer-events-none"
          aria-hidden
        />
        <div
          className="absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-[radial-gradient(closest-side,rgba(167,139,250,0.4),transparent)] pointer-events-none"
          aria-hidden
        />

        <div className="relative flex items-center gap-3 text-white">
          <Link to="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
            <div className="h-11 w-11 rounded-xl bg-white/15 grid place-items-center ring-1 ring-white/30">
              <img
                src={riceLogo}
                alt={t("Oraiza")}
                className="h-full w-full object-contain brightness-0 invert"
              />
            </div>
            <p className="text-lg font-bold tracking-tight">{t("Oraiza")}</p>
          </Link>
        </div>

        <div className="relative text-white max-w-md">
          <h2 className="text-4xl xl:text-5xl font-bold leading-[1.05] tracking-tight">
            {t("Start free.")}
            <br />
            <span className="bg-gradient-to-r from-white via-cyan-200 to-emerald-200 bg-clip-text text-transparent">
              {t("No card required.")}
            </span>
          </h2>
          <p className="mt-5 text-white text-base leading-relaxed">
            {t(
              "Set up your mill in under two minutes. We’ll get your books, batches, and inventory online in one place.",
            )}
          </p>

          <ul className="mt-10 space-y-3 text-base text-white font-medium">
            {[
              t("Unlimited transactions on the free tier"),
              t("Offline-first, works at the mill site"),
              t("NFA & DA reports built in"),
              t("Cloud sync across all your devices"),
            ].map((line) => (
              <li key={line} className="flex items-center gap-3">
                <div className="h-6 w-6 rounded-full bg-white/20 grid place-items-center ring-1 ring-white/30">
                  <Check size={13} />
                </div>
                {line}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-sm text-white/75">
          {t("© {{getFullYear}} Oraiza by K Systematics", {
            getFullYear: new Date().getFullYear(),
          })}
        </p>
      </div>

      {/* my-auto rather than items-center: it centres the form when there is
          room and, unlike items-center, never pushes its top out of reach.
          lg:pt-28 keeps the form clear of the Back button, which ends at 92px. */}
      <div className="flex justify-center px-6 pt-20 pb-6 lg:px-12 lg:pt-28 lg:pb-4 lg:overflow-y-auto">
        <div className="w-full max-w-lg my-auto animate-grad-fade-up">
          <Link
            to="/"
            className="lg:hidden flex items-center gap-3 mb-6 hover:opacity-80 transition-opacity"
          >
            <div className="h-11 w-11 rounded-xl bg-grad-brand grid place-items-center shadow-grad-glow">
              <img
                src={riceLogo}
                alt={t("Oraiza")}
                className="h-full w-full object-contain brightness-0 invert"
              />
            </div>
            <p className="text-lg font-bold tracking-tight text-primary">{t("Oraiza")}</p>
          </Link>

          <h1 className="text-3xl font-bold tracking-tight text-primary">
            {t("Create your account")}
          </h1>
          {/* Desktop hides this: the gradient panel beside it already says so. */}
          <p className="mt-1 text-base text-secondary lg:hidden">
            {t("Free to start. No credit card required.")}
          </p>

          {/* Step indicator */}
          <div className="mt-4 flex items-center gap-2">
            {[1, 2].map((s) => (
              <div
                key={s}
                className={`h-2 flex-1 rounded-full transition-all ${
                  step >= s ? "bg-grad-brand" : "bg-slate-300 dark:bg-slate-700"
                }`}
              />
            ))}
            <p className="ml-3 text-sm font-semibold text-secondary whitespace-nowrap">
              {t("Step {{step}} of 2", { step })}
            </p>
          </div>

          {step === 1 && (
            <div className="mt-5 space-y-4">
              <div>
                <label className="form-label">{t("Company name *")}</label>
                <input
                  className="input"
                  value={form.company_name}
                  onChange={(e) => update("company_name", e.target.value)}
                  placeholder={t("ABC Rice Mill Corp.")}
                />
              </div>

              {config?.invite_required && (
                <div>
                  <label className="form-label">{t("Invite code")}</label>
                  <input
                    className="input font-mono"
                    value={form.invite_code}
                    onChange={(e) => update("invite_code", e.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={t("Enter the code from your invitation")}
                  />
                  <p className="mt-1.5 text-xs text-muted">
                    {t("Required when public signup is restricted by your deployment.")}
                  </p>
                </div>
              )}

              <div>
                <label className="form-label">{t("Branch configuration")}</label>
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
                    <p className="font-bold text-primary">{t("Single location")}</p>
                    <p className="text-sm text-secondary mt-0.5">{t("One mill site")}</p>
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
                    <p className="font-bold text-primary">{t("Multi-branch")}</p>
                    <p className="text-sm text-secondary mt-0.5">{t("Two or more sites")}</p>
                  </button>
                </div>
              </div>

              <button
                onClick={() => setStep(2)}
                className="btn-primary w-full"
                disabled={!form.company_name.trim()}
              >
                {t("Continue")}
                <ArrowRight size={16} />
              </button>

              <p className="text-center text-base text-secondary">
                {t("Already have an account?")}{" "}
                <Link
                  to={withNext("/login", next)}
                  className="font-semibold text-grad-brand hover:opacity-80 transition-opacity"
                >
                  {t("Sign in")}
                </Link>
              </p>
            </div>
          )}

          {step === 2 && (
            <div className="mt-5 space-y-3">
              <div>
                <label className="form-label">{t("Full name *")}</label>
                <input
                  className="input"
                  value={form.full_name}
                  onChange={(e) => update("full_name", e.target.value)}
                  placeholder={t("Juan Dela Cruz")}
                  autoComplete="name"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="form-label">{t("Username *")}</label>
                  <input
                    className="input"
                    value={form.username}
                    onChange={(e) => update("username", e.target.value)}
                    placeholder="juandc"
                    autoComplete="off"
                    {...NO_AUTOFILL}
                  />
                </div>
                <div>
                  <label className="form-label">{t("Email *")}</label>
                  <input
                    type="email"
                    className="input"
                    value={form.email}
                    onChange={(e) => update("email", e.target.value)}
                    placeholder="you@company.com"
                    autoComplete="off"
                    {...NO_AUTOFILL}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="form-label">{t("Password *")}</label>
                  <PasswordInput
                    className="input"
                    value={form.password}
                    onChange={(e) => update("password", e.target.value)}
                    placeholder={t("8+ characters")}
                    autoComplete="new-password"
                    {...NO_AUTOFILL}
                  />
                </div>
                <div>
                  <label className="form-label">{t("Confirm *")}</label>
                  <PasswordInput
                    className="input"
                    value={form.confirm}
                    onChange={(e) => update("confirm", e.target.value)}
                    placeholder="••••••••"
                    autoComplete="new-password"
                    {...NO_AUTOFILL}
                  />
                </div>
              </div>

              {error && (
                <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-rose-500/15 ring-1 ring-inset ring-rose-500/40 text-sm font-medium text-rose-700 dark:text-rose-300">
                  <AlertCircle size={16} className="mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {/* The whole sentence is the tap target, not just the small box.
                  The links open in a new tab, so reading them keeps the form. */}
              <label className="flex items-start gap-3 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={acceptedTerms}
                  onChange={(e) => {
                    setAcceptedTerms(e.target.checked);
                    if (e.target.checked && error === TICK_TERMS) setError("");
                  }}
                  className="mt-0.5 h-5 w-5 shrink-0 rounded accent-emerald-500"
                  data-testid="signup-accept-terms"
                />
                <span className="text-sm text-secondary leading-snug">
                  {tx(
                    "I have read and accept the {{terms}} and {{privacy}}, and I am authorised to accept them for my company.",
                    {
                      terms: (
                        <Link
                          to="/legal/terms"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="link"
                        >
                          {t("Terms of Service")}
                        </Link>
                      ),
                      privacy: (
                        <Link
                          to="/legal/privacy"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="link"
                        >
                          {t("Privacy Policy")}
                        </Link>
                      ),
                    },
                  )}
                </span>
              </label>

              {config?.turnstile_site_key && (
                <TurnstileWidget
                  ref={turnstile}
                  siteKey={config.turnstile_site_key}
                  action="signup"
                  onToken={setTurnstileToken}
                />
              )}

              <div className="pt-1">
                <button
                  onClick={submit}
                  className="btn-primary w-full"
                  disabled={
                    loading ||
                    !form.full_name ||
                    !form.username ||
                    !form.email ||
                    !form.password ||
                    (!!config?.turnstile_site_key && !turnstileToken)
                  }
                >
                  {loading ? t("Creating…") : t("Create account")}
                  {!loading && <ArrowRight size={16} />}
                </button>
              </div>

              {/* Google sign-up only when it is set up: see googleSignIn.ts. */}
              {googleSignInEnabled() && (
                <>
                  <div className="relative flex items-center">
                    <div className="flex-grow border-t border-slate-200 dark:border-slate-800"></div>
                    <span className="flex-shrink-0 mx-4 text-sm text-secondary">{t("or")}</span>
                    <div className="flex-grow border-t border-slate-200 dark:border-slate-800"></div>
                  </div>

                  <div className="relative flex justify-center w-full [&>div]:w-full">
                    <GoogleLogin
                      onSuccess={handleGoogleSuccess}
                      onError={() => setError(t("Google signup failed."))}
                    />
                    {/* Until the box is ticked, a click here says so straight away
                        rather than after the visitor has been through Google's
                        sign-in window. */}
                    {!acceptedTerms && (
                      <button
                        type="button"
                        onClick={() => setError(TICK_TERMS)}
                        className="absolute inset-0 cursor-pointer"
                        aria-label={t("Sign up with Google")}
                      />
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
