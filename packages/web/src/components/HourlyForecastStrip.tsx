import { Droplets } from "lucide-react";
import type { HourlyForecast } from "../hooks/useWeather";
import { conditionText, weatherIcon, weatherIconClass } from "./weatherIcons";
import { t } from "../i18n";
import { hourLabel as hourOf } from "../utils/dryingAdvice";

/** Format a local-ISO hour ("2026-06-15T13:00") as "1 PM" / "Now". */
function hourLabel(iso: string, isFirst: boolean): string {
  if (isFirst) return t("Now");
  if (Number.isNaN(Number(iso.slice(11, 13)))) return iso.slice(11, 16);
  return hourOf(iso);
}

/** The coming hours as a row of tiles, sliding sideways when they don't fit.
 *  The weather card's Hourly view; the 7 days are DailyForecastStrip. */
export default function HourlyForecastStrip({ hourly }: { hourly: HourlyForecast[] }) {
  return (
    <div
      className="flex gap-2 overflow-x-auto overscroll-x-contain py-2 -mx-1 px-1"
      data-testid="hourly-forecast"
    >
      {hourly.map((h, i) => {
        const Icon = weatherIcon(h.condition_code, h.is_daytime);
        const tint = weatherIconClass(h.condition_code, h.is_daytime);
        return (
          <div
            key={h.time}
            className="shrink-0 w-[4.5rem] rounded-2xl ring-1 ring-soft bg-white/50 dark:bg-slate-800/50 px-2 py-3 flex flex-col items-center gap-1.5"
            title={conditionText(h.condition_code, h.condition)}
          >
            <span className="text-[11px] font-semibold text-muted whitespace-nowrap">
              {hourLabel(h.time, i === 0)}
            </span>
            <Icon size={22} className={tint} />
            <span className="text-sm font-bold text-primary tabular-nums">
              {h.temp_c != null ? `${Math.round(h.temp_c)}°` : "—"}
            </span>
            {h.precip_pct != null && h.precip_pct > 0 ? (
              <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-sky-500 tabular-nums">
                <Droplets size={10} />
                {h.precip_pct}%
              </span>
            ) : (
              <span className="text-[10px] text-transparent select-none">·</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
