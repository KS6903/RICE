import { Cloud, Droplets } from "lucide-react";
import type { DailyForecast } from "../hooks/useWeather";
import { conditionText, WEATHER_ICONS, weatherIconClass } from "./weatherIcons";
import { currentLocale, t } from "../i18n";

/** Format a local date ("2026-06-15") as "Today" or a weekday name. */
function dayLabel(date: string, isFirst: boolean): string {
  if (isFirst) return t("Today");
  // Parse as local date (no TZ shift): the parts are already location-local.
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1);
  return new Intl.DateTimeFormat(currentLocale(), { weekday: "short" }).format(dt);
}

/** The next 7 days as a row of tiles, sliding sideways when they don't fit. */
export default function DailyForecastStrip({ daily }: { daily: DailyForecast[] }) {
  return (
    <div
      className="flex gap-2 overflow-x-auto overscroll-x-contain py-2 -mx-1 px-1"
      data-testid="daily-forecast"
    >
      {daily.map((d, i) => {
        const Icon = WEATHER_ICONS[d.condition_code] ?? Cloud;
        const tint = weatherIconClass(d.condition_code, true);
        return (
          <div
            key={d.date}
            className="shrink-0 w-[4.5rem] flex-1 min-w-[4.5rem] rounded-2xl ring-1 ring-soft bg-white/50 dark:bg-slate-800/50 px-2 py-3 flex flex-col items-center gap-1.5"
            title={conditionText(d.condition_code, d.condition)}
          >
            <span className="text-[11px] font-semibold text-muted whitespace-nowrap">
              {dayLabel(d.date, i === 0)}
            </span>
            <Icon size={22} className={tint} />
            <span className="text-sm font-bold text-primary tabular-nums">
              {d.temp_max_c != null ? `${Math.round(d.temp_max_c)}°` : "—"}
            </span>
            <span className="text-[11px] font-medium text-muted tabular-nums -mt-1">
              {d.temp_min_c != null ? `${Math.round(d.temp_min_c)}°` : "—"}
            </span>
            {d.precip_pct != null && d.precip_pct > 0 ? (
              <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-sky-500 tabular-nums">
                <Droplets size={10} />
                {d.precip_pct}%
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
