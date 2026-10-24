import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useIsFetching, useQueryClient, type Query } from "@tanstack/react-query";
import { useAfterDelay } from "../../hooks/useAfterDelay";
import { DEFAULT_STALE_TIME } from "../../services/queryClient";

/** A page's own data: the queries on the default freshness. The ones that set
 *  their own staleTime (the session check, notifications, weather, places, the
 *  drying advice) keep their own schedule. The type leaves staleTime off a
 *  query's options, but they carry it: they are the options it was built with. */
const isPageData = (query: Query) =>
  (query.options as { staleTime?: unknown }).staleTime === DEFAULT_STALE_TIME;

/**
 * Opening a page refreshes it. The page still shows what it had a moment ago,
 * but its data is asked for again, so what someone else just entered (a sale, a
 * purchase) shows up rather than a copy up to 5 minutes old.
 *
 * While a page's data is on its way, a thin bar runs across the top of the
 * screen, so a slow answer reads as loading and not as an empty or broken page.
 * A load still going after 5 seconds is almost always the server waking up
 * after a quiet spell, and a note says so.
 */
export default function PageLoadingBar() {
  const { pathname } = useLocation();
  const queryClient = useQueryClient();

  // After the new page's queries have mounted (children's effects run first):
  // refetch the ones on screen, mark the rest stale for when they are next
  // shown, and leave a fetch already under way alone rather than restart it.
  useEffect(() => {
    void queryClient.invalidateQueries({ predicate: isPageData }, { cancelRefetch: false });
  }, [pathname, queryClient]);

  const loading = useIsFetching({ predicate: isPageData }) > 0;
  // A quick answer shows nothing, so a fast page doesn't flicker.
  const show = useAfterDelay(loading, 200);
  const slow = useAfterDelay(loading, 5000);
  if (!show) return null;

  return (
    <div role="status" data-testid="page-loading">
      <span className="sr-only">Loading</span>
      <div className="fixed inset-x-0 top-0 z-[70] h-0.5 overflow-hidden" aria-hidden>
        <div className="h-full w-full animate-shimmer bg-gradient-to-r from-transparent via-emerald-500 to-transparent motion-reduce:animate-none" />
      </div>
      {slow && (
        <p className="fixed bottom-4 left-1/2 z-[70] w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-full glass px-4 py-2 text-center text-sm font-medium text-secondary shadow-lg">
          Still loading. The server may be waking up, which can take up to 20 seconds.
        </p>
      )}
    </div>
  );
}
