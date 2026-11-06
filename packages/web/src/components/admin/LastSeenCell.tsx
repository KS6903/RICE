import { activeNow, lastSeenText } from "../../utils/lastSeen";

/** When someone (or anyone in a mill) last used the app, with a green dot
 *  while they are using it now. The exact time is in the tooltip. */
export default function LastSeenCell({ iso }: { iso: string | null | undefined }) {
  const now = activeNow(iso);
  return (
    <span
      className={`inline-flex items-center gap-1.5 ${now ? "font-semibold text-emerald-700 dark:text-emerald-400" : "text-secondary"}`}
      title={iso ? new Date(iso).toLocaleString() : undefined}
    >
      {now && <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden />}
      {lastSeenText(iso)}
    </span>
  );
}
