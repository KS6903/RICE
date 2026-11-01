import { useEffect, useRef } from "react";
import { NavigationType, useLocation, useNavigationType, type Location } from "react-router-dom";
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

/** Whether a page change loads the page afresh. A redirect (a replace) doesn't: it
 *  only corrects where the person landed, on a page that has just loaded clean. */
function reloadsOnChange(type: NavigationType): boolean {
  if (type === NavigationType.Replace) return false;
  if (isElectronRuntime() || useHelpStore.getState().touring) return false;
  try {
    return Date.now() - Number(sessionStorage.getItem(STAMP) ?? 0) >= REDIRECT_WINDOW_MS;
  } catch {
    return true;
  }
}

/** Every time the person goes to another page, the browser loads it afresh, as
 *  if they had pressed refresh: the link changes and the page starts clean, not
 *  just swaps in place. Only the path counts; a tab or filter in the query does
 *  not. A click on a link to the page already open reloads it too. The guided
 *  tour walks the pages with its place held in memory, so while it runs they
 *  change in place. The desktop app holds its tokens in memory only, so a reload
 *  would sign it out: there pages change in place too.
 *
 *  Returns the location to draw. While the browser fetches the new document it
 *  stays the page the person is leaving: drawing the new one here too would show
 *  it twice, once now and once when the reload wipes it and starts again. Called
 *  inside the Router. */
export default function useReloadOnPageChange(): Location {
  const location = useLocation();
  const type = useNavigationType();
  const drawn = useRef(location);

  if (location.pathname === drawn.current.pathname || !reloadsOnChange(type)) {
    drawn.current = location;
  }

  useEffect(() => {
    if (location.pathname === drawn.current.pathname) return;
    try {
      sessionStorage.setItem(STAMP, String(Date.now()));
    } catch {
      // No session storage: reload anyway.
    }
    reloadPage();
  }, [location.pathname]);

  useEffect(() => {
    if (isElectronRuntime()) return;
    document.addEventListener("click", reloadOnSamePageLink, true);
    return () => document.removeEventListener("click", reloadOnSamePageLink, true);
  }, []);

  return drawn.current;
}
