import { isElectronRuntime } from "../services/runtime";

// Where to go after signing in or up. Only pages named here: a ?next= link is
// something anyone can send, so it must never lead off the app or anywhere a
// stranger chose.
const ALLOWED = new Set(["/retrieve-data"]);

export function safeNext(params: URLSearchParams): string | null {
  const next = params.get("next");
  return next && ALLOWED.has(next) ? next : null;
}

/** Opens the app once signed in or up. In a browser it is a full page load, like
 *  pressing refresh: the app starts clean on the new session and the browser
 *  shows it loading, instead of the form swapping straight to a half-filled
 *  dashboard. The desktop app holds its tokens in memory only, so a reload would
 *  sign it out: there it moves in place. */
export function enterApp(path: string, navigate: (to: string) => void): void {
  if (isElectronRuntime()) navigate(path);
  else window.location.assign(path);
}

/** ``path`` carrying the same ?next= on to the next page. */
export function withNext(path: string, next: string | null): string {
  return next ? `${path}?next=${encodeURIComponent(next)}` : path;
}
