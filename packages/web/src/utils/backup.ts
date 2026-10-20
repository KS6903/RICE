// Shared by the backup download (Settings → Your data) and the upload
// (LoadBackup, /retrieve-data).
import { isAxiosError } from "axios";

export const ERROR_TEXT = "text-sm text-rose-600 dark:text-rose-400";
export const DONE_TEXT = "text-sm text-emerald-700 dark:text-emerald-300";

/** "Oct 12, 2026" for the date a backup was made. */
export function madeOn(iso: string): string {
  const day = new Date(iso);
  return Number.isNaN(day.getTime())
    ? iso.slice(0, 10)
    : day.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
}

/** The server's own words for a refusal, or ours when it has none. */
export function problem(error: unknown, fallback: string): string {
  if (!isAxiosError(error)) return fallback;
  if (error.response?.status === 429) return "You've tried a few times this hour. Try again later.";
  const detail = error.response?.data?.detail;
  return typeof detail === "string" ? detail : fallback;
}

/** Hand a downloaded file to the browser to save. */
export function save(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
