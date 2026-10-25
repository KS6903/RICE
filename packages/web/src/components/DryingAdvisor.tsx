import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CloudDrizzle, CloudRain, Info, Lock } from "lucide-react";
import { clsx } from "clsx";
import { useFeature } from "../hooks/useFeature";
import { useDryingBanner } from "../hooks/useDryingBanner";
import type { Coords } from "../hooks/useGeolocation";
import type { HourlyForecast } from "../hooks/useWeather";
import type { DryingVerdict } from "../utils/dryingAdvice";
import AiSunIcon from "./AiSunIcon";

const VERDICT_ICON: Record<DryingVerdict, React.ElementType> = {
  good: AiSunIcon,
  caution: CloudDrizzle,
  poor: CloudRain,
};

const VERDICT_STYLES: Record<DryingVerdict, { box: string; icon: string }> = {
  good: {
    box: "bg-emerald-50 text-emerald-950 dark:bg-emerald-400/10 dark:text-emerald-50",
    icon: "text-emerald-600 dark:text-emerald-300",
  },
  caution: {
    box: "bg-amber-50 text-amber-950 dark:bg-amber-400/10 dark:text-amber-50",
    icon: "text-amber-600 dark:text-amber-300",
  },
  poor: {
    box: "bg-rose-50 text-rose-950 dark:bg-rose-400/10 dark:text-rose-50",
    icon: "text-rose-600 dark:text-rose-300",
  },
};

const CAVEAT =
  "Worked out from third-party weather forecasts. It can be wrong or out of date, and it isn't " +
  "agronomic advice. Check the actual weather before laying out or moving palay. See the Terms " +
  "of Service.";

const TOOLTIP_WIDTH = 260;
const VIEWPORT_MARGIN = 12;
const SHOW_DELAY_MS = 120;

/** The "only an estimate" caveat, behind an info icon at the end of the line.
 *  A portal, because the weather card clips its overflow. */
function CaveatTooltip() {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const showTimeout = useRef<number | null>(null);
  const [shown, setShown] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(
    () => () => {
      if (showTimeout.current) window.clearTimeout(showTimeout.current);
    },
    [],
  );

  const show = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const left = Math.min(
      Math.max(rect.right - TOOLTIP_WIDTH, VIEWPORT_MARGIN),
      window.innerWidth - TOOLTIP_WIDTH - VIEWPORT_MARGIN,
    );
    setPos({ top: rect.bottom + 6, left });
    showTimeout.current = window.setTimeout(() => setShown(true), SHOW_DELAY_MS);
  };
  const hide = () => {
    if (showTimeout.current) window.clearTimeout(showTimeout.current);
    showTimeout.current = null;
    setShown(false);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        className="shrink-0 opacity-60 hover:opacity-100 focus:opacity-100"
        aria-label="About this advice"
        data-testid="drying-advisor-info"
      >
        <Info size={15} />
      </button>
      {pos &&
        createPortal(
          <div
            role="tooltip"
            className={clsx(
              "fixed z-[100] rounded-xl ring-1 ring-soft shadow-xl bg-white dark:bg-slate-800 p-2.5 text-[11px] leading-snug text-secondary transition-opacity motion-reduce:transition-none",
              shown ? "opacity-100" : "opacity-0 pointer-events-none",
            )}
            style={{ top: pos.top, left: pos.left, width: TOOLTIP_WIDTH }}
            data-testid="drying-advisor-info-tooltip"
          >
            {CAVEAT}
          </div>,
          document.body,
        )}
    </>
  );
}

/** Palay drying advice, one line under the current weather: when to spread
 *  the palay and when to bring it in. Basic and up, like the AI advisor it
 *  comes from; other plans see where to get it. */
export default function DryingAdvisor({
  coords,
  hourly,
}: {
  coords: Coords | null;
  hourly: HourlyForecast[] | undefined;
}) {
  const allowed = useFeature("drying_advisor");
  if (!allowed) {
    return (
      <p
        className="mt-4 flex items-center gap-2.5 rounded-xl bg-slate-500/5 px-4 py-3 text-sm text-secondary"
        data-testid="drying-advisor-upsell"
      >
        <Lock size={16} className="shrink-0 text-amber-500" />
        Palay drying advice comes with the Basic plan and up.
      </p>
    );
  }
  return <Advice coords={coords} hourly={hourly} />;
}

function Advice({
  coords,
  hourly,
}: {
  coords: Coords | null;
  hourly: HourlyForecast[] | undefined;
}) {
  const banner = useDryingBanner(coords, hourly);
  // Nothing to go on yet (or at all): leave the space out rather than say so.
  if (!banner) return null;
  const Icon = VERDICT_ICON[banner.verdict] ?? AiSunIcon;
  const styles = VERDICT_STYLES[banner.verdict] ?? VERDICT_STYLES.good;
  return (
    <div
      className={clsx("mt-4 flex items-center gap-3 rounded-xl px-4 py-3", styles.box)}
      data-testid="drying-advisor"
      data-verdict={banner.verdict}
      data-source={banner.source}
    >
      <Icon
        size={banner.verdict === "good" ? 26 : 18}
        className={clsx("shrink-0", styles.icon)}
        aria-hidden
      />
      <p
        className="min-w-0 flex-1 text-sm leading-relaxed line-clamp-3 sm:line-clamp-2"
        title={`${banner.headline} ${banner.detail}`}
      >
        <span className="font-semibold">{banner.headline}</span> {banner.detail}
      </p>
      <CaveatTooltip />
    </div>
  );
}
