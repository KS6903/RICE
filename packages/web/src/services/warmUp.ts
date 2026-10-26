import { t } from "../i18n";
let started = false;

/**
 * Wake the API before anyone needs it. The hosted API sleeps when idle, and the
 * first request after that waits for it to boot (10 seconds or more). Called
 * when the front page, sign-in or sign-up page opens, so it boots while the
 * person types, and the sign-in itself finds it awake. The readiness check
 * also opens the database and Redis connections.
 *
 * Once per page load, fire and forget: nothing waits on it, and a failure
 * changes nothing.
 */
export function warmUpApi(): void {
  if (started) return;
  started = true;
  try {
    void fetch("/api/health/ready", { cache: "no-store", credentials: "omit" }).catch(() => {});
  } catch {
    // No fetch (very old browser, or a test environment): nothing to warm.
  }
}

/**
 * What to say when a sign-in or sign-up got no real answer: the browser couldn't
 * reach the server, or the server didn't answer in time (a gateway error, or the
 * Worker's "upstream_unavailable"). Null when the server did answer, so the
 * caller shows the server's own message. Without this, a server that wasn't
 * ready could read as "Invalid username or password."
 */
export function serverUnreachableMessage(err: any): string | null {
  const res = err?.response;
  if (!res) {
    return err?.request
      ? t("Couldn't reach the server. Check your internet connection and try again.")
      : null;
  }
  if (res.status === 502 || res.status === 504 || res.data?.code === "upstream_unavailable") {
    return t("Something went wrong. Please try again.");
  }
  return null;
}

/** For tests only. */
export function resetWarmUpForTests(): void {
  started = false;
}
