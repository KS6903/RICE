// Where to go after signing in or up. Only pages named here: a ?next= link is
// something anyone can send, so it must never lead off the app or anywhere a
// stranger chose.
const ALLOWED = new Set(["/retrieve-data"]);

export function safeNext(params: URLSearchParams): string | null {
  const next = params.get("next");
  return next && ALLOWED.has(next) ? next : null;
}

/** ``path`` carrying the same ?next= on to the next page. */
export function withNext(path: string, next: string | null): string {
  return next ? `${path}?next=${encodeURIComponent(next)}` : path;
}
