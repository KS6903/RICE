import { useEffect } from "react";
import { isElectronRuntime } from "../services/runtime";
import { pendingLogout } from "../stores/authStore";
import { useHelpStore } from "../stores/helpStore";

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

/** Going to another page changes it in place, so a page visited a moment ago
 *  draws at once from the data already fetched (services/queryClient.ts). A
 *  click on a link to the page already open reloads it. The guided tour walks
 *  the pages with its place held in memory, and the desktop app holds its
 *  tokens in memory only, so neither reloads on that click. */
export default function useReloadOnSamePageLink(): void {
  useEffect(() => {
    if (isElectronRuntime()) return;
    document.addEventListener("click", reloadOnSamePageLink, true);
    return () => document.removeEventListener("click", reloadOnSamePageLink, true);
  }, []);
}
