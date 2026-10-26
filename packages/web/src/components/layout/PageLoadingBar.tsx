import { useIsFetching, type Query } from "@tanstack/react-query";
import { useAfterDelay } from "../../hooks/useAfterDelay";
import { DEFAULT_STALE_TIME } from "../../services/queryClient";
import { t } from "../../i18n";

/** A page's own data: the queries on the default freshness. The ones that set
 *  their own staleTime (the session check, notifications, weather, places, the
 *  drying advice) keep their own schedule. The type leaves staleTime off a
 *  query's options, but they carry it: they are the options it was built with. */
const isPageData = (query: Query) =>
  (query.options as { staleTime?: unknown }).staleTime === DEFAULT_STALE_TIME;

/** A thin bar marks first loads; cached data stays on screen during background
 *  refreshes so switching back to a page never waits for its network request. */
export default function PageLoadingBar() {
  // Cached pages stay visible while TanStack Query refreshes stale data in the
  // background. Only show the bar when a page has no cached data yet.
  const loading =
    useIsFetching({
      predicate: (query) => isPageData(query) && query.state.data === undefined,
    }) > 0;
  const show = useAfterDelay(loading, 200);
  if (!show) return null;

  return (
    <div role="status" data-testid="page-loading">
      <span className="sr-only">{t("Loading")}</span>
      <div className="fixed inset-x-0 top-0 z-[70] h-0.5 overflow-hidden" aria-hidden>
        <div className="h-full w-full animate-shimmer bg-gradient-to-r from-transparent via-emerald-500 to-transparent motion-reduce:animate-none" />
      </div>
    </div>
  );
}
