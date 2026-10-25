import { Loader2 } from "lucide-react";
import riceLogo from "../assets/Rice_Logo.svg";

/** Covers the sign-in or sign-up form while it is sent. It stays up until the
 *  app opens (a page load, see enterApp) or the answer comes back wrong, when it
 *  lifts off the form, which is still filled in, to show what went wrong. */
export default function AuthLoadingScreen({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-5 bg-white dark:bg-slate-950"
    >
      <div className="h-14 w-14 rounded-xl bg-grad-brand grid place-items-center shadow-grad-glow">
        <img src={riceLogo} alt="" className="h-full w-full object-contain brightness-0 invert" />
      </div>
      <p className="flex items-center gap-2 text-base font-semibold text-primary">
        <Loader2 size={18} className="animate-spin motion-reduce:animate-none" aria-hidden />
        {label}
      </p>
    </div>
  );
}
