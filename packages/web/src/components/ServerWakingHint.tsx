import { Loader2 } from "lucide-react";

/** Under a sign-in or sign-up button that has been busy for a few seconds. That
 *  is almost always the hosted server waking up after a quiet spell, so say so
 *  rather than leave the button looking stuck. */
export default function ServerWakingHint() {
  return (
    <p role="status" className="flex items-start gap-2 text-sm text-secondary">
      <Loader2
        size={16}
        className="mt-0.5 shrink-0 animate-spin motion-reduce:animate-none"
        aria-hidden
      />
      <span>
        Still working. The server may be waking up after a quiet spell, which can take up to 20
        seconds.
      </span>
    </p>
  );
}
