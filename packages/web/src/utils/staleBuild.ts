import { isElectronRuntime } from "../services/runtime";

const STAMP = "stale-build-reload-at";
// A second failure this soon after reloading means the files really are missing,
// not that this tab is old, and reloading again would loop.
const LOOP_WINDOW_MS = 10_000;

/** A page of the app failed to load its code. The usual cause: the tab was
 *  open when a new build went up, and the file names it knows are gone. The
 *  wording differs by browser (Chrome, Firefox, Safari). */
export function isStaleBuildError(error: unknown): boolean {
  const said = String((error as { message?: unknown } | null)?.message ?? error);
  return /dynamically imported module|importing a module script failed|unable to preload css|ChunkLoadError/i.test(
    said,
  );
}

/** Loads the current build. Returns false when it did not: it already did so a
 *  moment ago, or this is the desktop app, whose files ship with it. */
export function reloadForNewBuild(): boolean {
  if (isElectronRuntime()) return false;
  try {
    const last = Number(sessionStorage.getItem(STAMP) ?? 0);
    if (Date.now() - last < LOOP_WINDOW_MS) return false;
    sessionStorage.setItem(STAMP, String(Date.now()));
  } catch {
    // No session storage: reload anyway.
  }
  window.location.reload();
  return true;
}
