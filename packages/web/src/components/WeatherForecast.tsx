import { Cloud, Loader2, Droplets, CalendarDays, Clock3 } from "lucide-react";
import { useActiveLocation } from "../hooks/useActiveLocation";
import { useForecast, type HourlyForecast, type DailyForecast } from "../hooks/useWeather";
import { WEATHER_ICONS, weatherIconClass } from "./weatherIcons";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Format a local-ISO hour ("2026-06-15T13:00") as "1 PM" / "Now". */
function hourLabel(iso: string, isFirst: boolean): string {
  if (isFirst) return "Now";
  const h = Number(iso.slice(11, 13));
  if (Number.isNaN(h)) return iso.slice(11, 16);
  const period = h < 12 ? "AM" : "PM";
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display} ${period}`;
}

/** Format a local date ("2026-06-15") as "Today" or a weekday name. */
function dayLabel(date: string, isFirst: boolean): string {
  if (isFirst) return "Today";
  // Parse as local date (no TZ shift): the parts are already location-local.
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1);
  return DAY_NAMES[dt.getDay()] ?? date;
}

/** Hourly (today) + 7-day forecast panel for the active location. Sits under
 *  the current-conditions WeatherWidget on the dashboard.
 *
 *  Both rows are horizontal slidable strips that scroll on their own. (They
 *  used to be scroll-linked, which on a phone made them fight each other: a
 *  swipe's momentum kept echoing positions back and forth between the two.) */
export default function WeatherForecast() {
  const active = useActiveLocation();
  const coords =
    active.lat != null && active.lon != null ? { lat: active.lat, lon: active.lon } : null;
  const q = useForecast(coords);

  if (q.isLoading) {
    return (
      <div className="card flex items-center gap-2" data-testid="weather-forecast">
        <Loader2 size={18} className="animate-spin text-muted" />
        <span className="text-sm text-muted">Loading forecast…</span>
      </div>
    );
  }

  if (q.isError || !q.data) {
    const detail = (q.error as any)?.response?.data?.detail ?? "Forecast unavailable.";
    const msg = typeof detail === "string" ? detail : "Forecast unavailable";
    return (
      <div className="card flex items-center gap-2" data-testid="weather-forecast" title={msg}>
        <Cloud size={18} className="text-muted" />
        <span className="text-sm text-muted">Forecast unavailable</span>
      </div>
    );
  }

  const { hourly, daily } = q.data;

  return (
    <div className="card space-y-6" data-testid="weather-forecast">
      {/* ── Today, hour by hour ── */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Clock3 size={16} className="text-sky-500" />
          <h3 className="text-sm font-bold uppercase tracking-wide text-secondary">
            Today · hourly
          </h3>
        </div>
        <div className="flex gap-2 overflow-x-auto overscroll-x-contain py-2 -mx-1 px-1">
          {hourly.map((h: HourlyForecast, i: number) => {
            const Icon = WEATHER_ICONS[h.condition_code] ?? Cloud;
            const tint = weatherIconClass(h.condition_code, h.is_daytime);
            return (
              <div
                key={h.time}
                className="shrink-0 w-[4.5rem] rounded-2xl ring-1 ring-soft bg-white/50 dark:bg-slate-800/50 px-2 py-3 flex flex-col items-center gap-1.5"
                title={h.condition}
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
      </div>

      {/* ── Next 7 days — the same kind of slidable strip ── */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <CalendarDays size={16} className="text-violet-500" />
          <h3 className="text-sm font-bold uppercase tracking-wide text-secondary">
            7-day forecast
          </h3>
        </div>
        <div className="flex gap-2 overflow-x-auto overscroll-x-contain py-2 -mx-1 px-1">
          {daily.map((d: DailyForecast, i: number) => {
            const Icon = WEATHER_ICONS[d.condition_code] ?? Cloud;
            const tint = weatherIconClass(d.condition_code, true);
            return (
              <div
                key={d.date}
                className="shrink-0 w-[4.5rem] rounded-2xl ring-1 ring-soft bg-white/50 dark:bg-slate-800/50 px-2 py-3 flex flex-col items-center gap-1.5"
                title={d.condition}
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
      </div>
    </div>
  );
}
