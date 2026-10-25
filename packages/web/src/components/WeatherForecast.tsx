import { Cloud, Loader2, Droplets, Clock3 } from "lucide-react";
import { useActiveLocation } from "../hooks/useActiveLocation";
import { useForecast, type HourlyForecast } from "../hooks/useWeather";
import { weatherIcon, weatherIconClass } from "./weatherIcons";

/** Format a local-ISO hour ("2026-06-15T13:00") as "1 PM" / "Now". */
function hourLabel(iso: string, isFirst: boolean): string {
  if (isFirst) return "Now";
  const h = Number(iso.slice(11, 13));
  if (Number.isNaN(h)) return iso.slice(11, 16);
  const period = h < 12 ? "AM" : "PM";
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display} ${period}`;
}

/** Today hour by hour for the active location, a horizontal slidable strip.
 *  Sits under the current-conditions WeatherWidget on the dashboard; the 7-day
 *  forecast is the widget's own "7 days" switch. */
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

  const { hourly } = q.data;

  return (
    <div className="card" data-testid="weather-forecast">
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
            const Icon = weatherIcon(h.condition_code, h.is_daytime);
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
    </div>
  );
}
