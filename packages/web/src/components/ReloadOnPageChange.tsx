import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { isElectronRuntime } from "../services/runtime";

const STAMP = "page-reload-at";
// Two page changes closer than this are a redirect, not a person moving on, and
// reloading again could loop.
const REDIRECT_WINDOW_MS = 1000;

/** Every time the person goes to another page, the browser loads it afresh, as
 *  if they had pressed refresh: the link changes and the page starts clean, not
 *  just swaps in place. Only the path counts; a tab or filter in the query does
 *  not. The desktop app holds its tokens in memory only, so a reload would sign
 *  it out: there pages change in place. Rendered inside the Router. */
export default function ReloadOnPageChange() {
  const { pathname } = useLocation();
  const shown = useRef(pathname);

  useEffect(() => {
    if (shown.current === pathname) return;
    shown.current = pathname;
    if (isElectronRuntime()) return;
    try {
      const last = Number(sessionStorage.getItem(STAMP) ?? 0);
      if (Date.now() - last < REDIRECT_WINDOW_MS) return;
      sessionStorage.setItem(STAMP, String(Date.now()));
    } catch {
      // No session storage: reload anyway.
    }
    window.location.reload();
  }, [pathname]);

  return null;
}
