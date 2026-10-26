import { useState } from "react";
import { useAuthStore } from "../stores/authStore";
import { authService } from "../services/AuthService";
import { MailWarning, Loader2, Check } from "lucide-react";

/** Soft prompt shown in the app shell when the signed-in user hasn't verified
 *  their email but verification isn't strictly enforced. Offers a resend.
 *  (When enforcement IS on, the blocking EmailVerificationGate is shown instead,
 *  so this banner only appears in the soft case.) */
export default function VerifyEmailBanner() {
  const user = useAuthStore((s) => s.user);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  // Only when there's an email, it's unverified, and not under hard enforcement.
  if (!user?.email || user.email_verified || user.email_verification_required) return null;

  const resend = async () => {
    setBusy(true);
    try {
      await authService.resendVerification();
      setSent(true);
    } catch {
      /* ignore — the banner stays; they can retry */
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 px-4 sm:px-6 py-2 text-sm font-medium bg-amber-500/15 text-amber-800 dark:text-amber-300 border-b border-amber-500/30">
      <MailWarning size={16} className="shrink-0" />
      <span className="min-w-0 flex-1 break-words">
        Please verify your email address ({user.email}) to keep your account secure.
      </span>
      {sent ? (
        <span className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
          <Check size={14} /> Sent
        </span>
      ) : (
        <button
          onClick={resend}
          disabled={busy}
          className="inline-flex items-center gap-1.5 font-semibold hover:opacity-80"
        >
          {busy && <Loader2 size={13} className="animate-spin" />} Resend link
        </button>
      )}
    </div>
  );
}
