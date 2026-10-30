import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { isElectronRuntime } from "../services/runtime";
import { pendingLogout } from "../stores/authStore";
import { useHelpStore } from "../stores/helpStore";

const STAMP = "page-reload-at";
// Two page changes closer than this are a redirect, not a person moving on, and
// reloading again could loop.
const REDIRECT_WINDOW_MS = 1000;

/** Loads the page afresh. A sign-out still telling the server finishes first:
 *  reloading sooner could cut the request off and leave the session alive. */
function reloadPage() {
  const signingOut = pendingLogout();
  if (signingOut) void signingOut.finally(() => window.location.reload());
  else window.location.reload();
}

/** A link to the page that is already open changes nothing, so the click would
 *  do nothing. It reloads the page instead, as a link does on a server-rendered
 *  site. A link that opens elsewhere, jumps within the page, or is clicked with
 *  a modifier key keeps its own behaviour. Runs in the capture phase, ahead of
 *  the router's own handler, which then sees the click already handled. */
function reloadOnSamePageLink(event: MouseEvent) {
  if (event.defaultPrevented || event.button !== 0 || useHelpStore.getState().touring) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const link = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
  if (!link || (link.target && link.target !== "_self") || link.hasAttribute("download")) return;
  if (link.href.includes("#")) return;
  const to = new URL(link.href);
  const here = window.location;
  if (to.origin !== here.origin || to.pathname !== here.pathname || to.search !== here.search) {
    return;
  }
  event.preventDefault();
  reloadPage();
}

/** Every time the person goes to another page, the browser loads it afresh, as
 *  if they had pressed refresh: the link changes and the page starts clean, not
 *  just swaps in place. Only the path counts; a tab or filter in the query does
 *  not. A click on a link to the page already open reloads it too. The guided
 *  tour walks the pages with its place held in memory, so while it runs they
 *  change in place. The desktop app holds its tokens in memory only, so a reload
 *  would sign it out: there pages change in place too. Rendered inside the
 *  Router. */
export default function ReloadOnPageChange() {
  const { pathname } = useLocation();
  const shown = useRef(pathname);

  useEffect(() => {
    if (shown.current === pathname) return;
    shown.current = pathname;
    if (isElectronRuntime() || useHelpStore.getState().touring) return;
    try {
      const last = Number(sessionStorage.getItem(STAMP) ?? 0);
      if (Date.now() - last < REDIRECT_WINDOW_MS) return;
      sessionStorage.setItem(STAMP, String(Date.now()));
    } catch {
      // No session storage: reload anyway.
    }
    reloadPage();
  }, [pathname]);

  useEffect(() => {
    if (isElectronRuntime()) return;
    document.addEventListener("click", reloadOnSamePageLink, true);
    return () => document.removeEventListener("click", reloadOnSamePageLink, true);
  }, []);

  return null;
}
