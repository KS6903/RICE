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

/** For tests only. */
export function resetWarmUpForTests(): void {
  started = false;
}
