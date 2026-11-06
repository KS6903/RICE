import { currentLocale, t } from "../i18n";

/** A browser renews its session every 15 minutes while the app is open, so
 *  anyone seen within this is using it now. */
const ACTIVE_NOW_MS = 20 * 60 * 1000;

/** How long ago someone was last seen, in the plainest words that fit:
 *  "Active now", "35 min ago", "Today, 3:14 PM", "Yesterday, 9:02 AM",
 *  "Mon, 4:10 PM" (this week), "Oct 3" (this year), "Mar 2025". */
export function lastSeenText(iso: string | null | undefined, now = new Date()): string {
  if (!iso) return t("Never");
  const when = new Date(iso);
  const ms = now.getTime() - when.getTime();
  const lang = currentLocale();
  if (ms < ACTIVE_NOW_MS) return t("Active now");
  if (ms < 60 * 60 * 1000) return t("{{count}} min ago", { count: Math.floor(ms / 60000) });
  const time = when.toLocaleTimeString(lang, { hour: "numeric", minute: "2-digit" });
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = 24 * 60 * 60 * 1000;
  if (when.getTime() >= startOfToday) return t("Today, {{time}}", { time });
  if (when.getTime() >= startOfToday - day) return t("Yesterday, {{time}}", { time });
  if (when.getTime() >= startOfToday - 6 * day) {
    return `${when.toLocaleDateString(lang, { weekday: "short" })}, ${time}`;
  }
  if (when.getFullYear() === now.getFullYear()) {
    return when.toLocaleDateString(lang, { month: "short", day: "numeric" });
  }
  return when.toLocaleDateString(lang, { month: "short", year: "numeric" });
}

/** True when the person is using the app now. */
export function activeNow(iso: string | null | undefined, now = new Date()): boolean {
  return !!iso && now.getTime() - new Date(iso).getTime() < ACTIVE_NOW_MS;
}
