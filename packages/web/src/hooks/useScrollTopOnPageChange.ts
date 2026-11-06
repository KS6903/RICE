import { useEffect, type RefObject } from "react";
import { useLocation } from "react-router-dom";

/** Pages change in place, so the scrolling area would keep the last page's
 *  place. A page change starts the new page at its top, as a fresh load did; a
 *  tab or filter in the query keeps the place. */
export default function useScrollTopOnPageChange(ref: RefObject<HTMLElement | null>): void {
  const { pathname } = useLocation();
  useEffect(() => {
    ref.current?.scrollTo?.(0, 0);
  }, [pathname, ref]);
}
