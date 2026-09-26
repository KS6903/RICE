import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CloudDrizzle, CloudRain, Lock, Sparkles, Sun } from "lucide-react";
import { useFeature } from "../hooks/useFeature";
import { useDryingAdvisory } from "../hooks/useDryingAdvisory";
import type { Coords } from "../hooks/useGeolocation";
import type { DryingVerdict } from "../services/DryingAdvisorService";

const VERDICT_ICON: Record<DryingVerdict, React.ElementType> = {
  good: Sun,
  caution: CloudDrizzle,
  poor: CloudRain,
};

const VERDICT_STYLES: Record<DryingVerdict, { box: string; popoverBox: string; icon: string; headline: string }> = {
  good: {
    box: "ring-emerald-200 dark:ring-emerald-800 bg-emerald-50 dark:bg-emerald-900/20",
    // Opaque (no /alpha): the popover floats via a portal over arbitrary page
    // content, not the weather card's own glassy backdrop, so it needs a
    // solid background to stay legible regardless of what's underneath.
    popoverBox: "ring-emerald-200 dark:ring-emerald-800 bg-emerald-50 dark:bg-emerald-900",
    icon: "text-emerald-500",
    headline: "text-emerald-900 dark:text-emerald-200",
  },
  caution: {
    box: "ring-amber-200 dark:ring-amber-800 bg-amber-50 dark:bg-amber-900/20",
    popoverBox: "ring-amber-200 dark:ring-amber-800 bg-amber-50 dark:bg-amber-900",
    icon: "text-amber-500",
    headline: "text-amber-900 dark:text-amber-200",
  },
  poor: {
    box: "ring-rose-200 dark:ring-rose-800 bg-rose-50 dark:bg-rose-900/20",
    popoverBox: "ring-rose-200 dark:ring-rose-800 bg-rose-50 dark:bg-rose-900",
    icon: "text-rose-500",
    headline: "text-rose-900 dark:text-rose-200",
  },
};
const FALLBACK_STYLE = {
  box: "ring-soft bg-slate-500/5",
  popoverBox: "ring-soft bg-white dark:bg-slate-800",
  icon: "text-slate-500",
  headline: "text-primary",
};

const POPOVER_WIDTH = 320;
const VIEWPORT_MARGIN = 12;
// A short delay before showing (not on hiding) avoids a flash when the
// cursor merely passes over the box on its way to the stat cards below.
const SHOW_DELAY_MS = 120;

type PopoverPos = { top: number; left: number };

/** Palay Drying Advisor (inline, lives inside the expanded weather card).
 *
 *  DeepSeek reads the same forecast the weather card shows and recommends
 *  whether it's a good day/week to sun-dry wet palay. Enterprise-plan only —
 *  other tenants see a compact upsell instead of the fetch firing at all.
 *  Hidden below lg so the weather card doesn't get cramped on small screens.
 *
 *  The result box itself always stays compact (1-line headline, 2-line
 *  reasoning) so it never grows the weather card or reflows anything around
 *  it. Full text appears in a hover popover rendered via a portal straight
 *  into document.body — the weather card has overflow-hidden (it clips a
 *  decorative blur circle), so an absolutely-positioned child here would get
 *  silently clipped; a portal escapes that entirely without touching the
 *  card's own layout/CSS. */
export default function DryingAdvisor({ coords }: { coords: Coords | null }) {
  const allowed = useFeature("drying_advisor");
  const q = useDryingAdvisory(coords, { enabled: allowed });
  const triggerRef = useRef<HTMLDivElement>(null);
  const showTimeout = useRef<number | null>(null);
  const [hovered, setHovered] = useState(false);
  const [pos, setPos] = useState<PopoverPos | null>(null);

  useEffect(() => {
    return () => {
      if (showTimeout.current) window.clearTimeout(showTimeout.current);
    };
  }, []);

  const scheduleShow = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const left = Math.min(
      Math.max(rect.left, VIEWPORT_MARGIN),
      window.innerWidth - POPOVER_WIDTH - VIEWPORT_MARGIN
    );
    setPos({ top: rect.bottom + 8, left });
    showTimeout.current = window.setTimeout(() => setHovered(true), SHOW_DELAY_MS);
  };

  const cancelShow = () => {
    if (showTimeout.current) {
      window.clearTimeout(showTimeout.current);
      showTimeout.current = null;
    }
    setHovered(false);
  };

  return (
    <div
      className="shrink-0 self-stretch hidden lg:flex flex-col justify-center w-56 pl-4 ml-1 border-l border-soft"
      data-testid="drying-advisor"
    >
      <div className="flex items-center gap-2">
        <div className="h-8 w-8 rounded-lg bg-grad-brand grid place-items-center shadow-grad-glow shrink-0">
          <Sparkles size={15} className="text-white" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-bold text-primary leading-tight">Drying Advisor</p>
          <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-violet-600 dark:text-violet-400">
            AI
          </span>
        </div>
      </div>

      {!allowed && (
        <div
          className="mt-2.5 rounded-xl ring-1 ring-amber-200 dark:ring-amber-800 bg-amber-50 dark:bg-amber-900/20 p-2.5 flex items-start gap-2"
          data-testid="drying-advisor-upsell"
        >
          <Lock size={13} className="text-amber-500 shrink-0 mt-0.5" />
          <p className="text-[11px] leading-snug text-amber-900 dark:text-amber-200">
            Available on <span className="font-semibold">Enterprise</span>. Ask your admin to upgrade.
          </p>
        </div>
      )}

      {allowed && q.isLoading && (
        <div className="mt-2.5 rounded-xl ring-1 ring-soft bg-slate-500/5 p-2.5 space-y-1.5" data-testid="drying-advisor-loading">
          <div className="flex items-center gap-1.5">
            <Sun size={13} className="text-amber-400 shrink-0" />
            <span className="h-2.5 w-20 rounded bg-slate-300/60 dark:bg-slate-600/50 animate-pulse" />
          </div>
          <span className="block h-2 w-full rounded bg-slate-200/70 dark:bg-slate-700/50" />
          <span className="block h-2 w-3/4 rounded bg-slate-200/70 dark:bg-slate-700/50" />
        </div>
      )}

      {allowed && !q.isLoading && (q.isError || !q.data) && (
        <p className="mt-2.5 text-[11px] text-muted" data-testid="drying-advisor-error">
          Advisor unavailable right now.
        </p>
      )}

      {allowed && q.data && (() => {
        const data = q.data;
        const Icon = VERDICT_ICON[data.verdict] ?? Sun;
        const styles = VERDICT_STYLES[data.verdict] ?? FALLBACK_STYLE;
        return (
          <>
            <div
              ref={triggerRef}
              onMouseEnter={scheduleShow}
              onMouseLeave={cancelShow}
              className={`mt-2.5 rounded-xl ring-1 p-2.5 cursor-help transition-colors ${styles.box}`}
              data-testid="drying-advisor-result"
            >
              <div className="flex items-start gap-1.5 min-w-0">
                <Icon size={13} className={`${styles.icon} shrink-0 mt-0.5`} />
                <span className={`text-xs font-semibold min-w-0 truncate ${styles.headline}`}>{data.headline}</span>
              </div>
              <p className="mt-1 text-[11px] leading-snug text-secondary line-clamp-2">{data.reasoning}</p>
              {data.best_window && (
                <p className="mt-1 text-[10px] text-muted truncate">Best: {data.best_window}</p>
              )}
            </div>
            {/* Always on screen with the verdict, never behind the hover. A
                disclaimer that only appears on hover is not a disclaimer, and
                this advisory drives decisions about stock worth real money. */}
            <p className="mt-1.5 text-[10px] leading-snug text-muted" data-testid="drying-advisor-disclaimer">
              Estimate from forecast data, not a guarantee. Check conditions yourself before drying.
            </p>

            {pos &&
              createPortal(
                <div
                  role="tooltip"
                  className={`fixed z-[100] rounded-xl ring-1 shadow-xl p-3 origin-top transition-[opacity,transform] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-opacity ${styles.popoverBox} ${
                    hovered
                      ? "duration-180 opacity-100 scale-100 translate-y-0"
                      : "duration-120 opacity-0 scale-95 -translate-y-1 pointer-events-none motion-reduce:scale-100 motion-reduce:translate-y-0"
                  }`}
                  style={{ top: pos.top, left: pos.left, width: POPOVER_WIDTH }}
                  data-testid="drying-advisor-popover"
                >
                  <div className="flex items-start gap-2 min-w-0">
                    <Icon size={16} className={`${styles.icon} shrink-0 mt-0.5`} />
                    <span className={`text-sm font-semibold min-w-0 ${styles.headline}`}>{data.headline}</span>
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-secondary">{data.reasoning}</p>
                  {data.best_window && (
                    <p className="mt-1.5 text-[11px] font-semibold text-muted">Best window: {data.best_window}</p>
                  )}
                  <p className="mt-2.5 pt-2 border-t border-soft text-[10px] leading-snug text-muted">
                    Automatically generated from third-party weather forecasts. It can be wrong,
                    stale or unavailable, and it is not agronomic advice. Always check actual
                    conditions before laying out or moving palay. See the{" "}
                    <a href="/legal/terms" target="_blank" rel="noopener noreferrer" className="link">
                      Terms of Service
                    </a>
                    .
                  </p>
                </div>,
                document.body
              )}
          </>
        );
      })()}
    </div>
  );
}
