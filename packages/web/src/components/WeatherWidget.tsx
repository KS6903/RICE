import { Cloud, CloudSunRain, Droplets, Loader2, Wind } from "lucide-react";
import { useActiveLocation } from "../hooks/useActiveLocation";
import { useWeather, useForecast } from "../hooks/useWeather";
import { WEATHER_ICONS as ICONS, weatherIconClass as iconClass } from "./weatherIcons";
import DryingAdvisor from "./DryingAdvisor";
import { rainOutlook } from "../utils/dryingAdvice";

type Variant = "compact" | "expanded";

export default function WeatherWidget({ variant = "compact" }: { variant?: Variant }) {
  // Source-of-truth resolver: saved default > browser GPS > backend IP fallback.
  // The user's manually-saved location wins so what they pinned follows them
  // across every device they log in from.
  const active = useActiveLocation();
  const coords =
    active.lat != null && active.lon != null ? { lat: active.lat, lon: active.lon } : null;
  const w = useWeather(coords);
  // The hourly forecast, for when rain is next likely and the drying advice:
  // the expanded card only, so the compact top-bar pill skips the fetch.
  const fc = useForecast(coords, { enabled: variant === "expanded" });

  // ── Loading state ──
  if (w.isLoading) {
    return (
      <Shell variant={variant} testid="weather-widget">
        <Loader2
          size={variant === "compact" ? 14 : 22}
          className="animate-spin text-muted shrink-0"
        />
        <span className="text-xs text-muted">Loading weather…</span>
      </Shell>
    );
  }

  // ── Fetch error ──
  if (w.isError || !w.data) {
    const detail = (w.error as any)?.response?.data?.detail ?? "Weather unavailable.";
    const msg = typeof detail === "string" ? detail : "Weather unavailable";
    return (
      <Shell variant={variant} testid="weather-widget" title={msg}>
        <Cloud size={variant === "compact" ? 14 : 22} className="text-muted shrink-0" />
        <span className="text-xs text-muted">Weather unavailable</span>
      </Shell>
    );
  }

  const p = w.data;
  const Icon = ICONS[p.condition_code] ?? Cloud;
  const tint = iconClass(p.condition_code, p.is_daytime);
  const tempLabel = p.temp_c != null ? `${Math.round(p.temp_c)}°` : "—";
  // The saved-favorite's label wins over whatever the backend echoed (saved
  // labels are user-chosen — "Manila, Philippines" — vs the IP guess which
  // could land on a different town).
  const placeLabel =
    active.source === "saved" && active.label
      ? active.label
      : (p.location.label ?? `${p.location.lat.toFixed(2)}, ${p.location.lon.toFixed(2)}`);

  if (variant === "compact") {
    return (
      <Shell
        variant="compact"
        testid="weather-widget"
        title={`${p.condition} · ${placeLabel} · feels like ${p.feels_like_c != null ? Math.round(p.feels_like_c) + "°C" : "—"} · ${p.provider}`}
      >
        <Icon size={16} className={`${tint} shrink-0`} data-testid="weather-icon" />
        <span
          className="text-sm font-semibold text-primary tabular-nums"
          data-testid="weather-temp"
        >
          {tempLabel}C
        </span>
        <span
          className="hidden md:inline text-xs text-secondary truncate max-w-[8rem]"
          data-testid="weather-location"
        >
          {placeLabel}
        </span>
      </Shell>
    );
  }

  // Expanded dashboard card: the reading on the left, humidity, wind and the
  // rain outlook on the right, the drying advice underneath.
  const rain = fc.data ? rainOutlook(fc.data.hourly) : null;
  return (
    <div data-testid="weather-widget" className="card">
      <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
        <div className="flex min-w-0 items-center gap-4">
          <Icon size={44} className={`${tint} shrink-0`} data-testid="weather-icon" />
          <div className="min-w-0">
            <p
              className="text-4xl font-extrabold leading-none text-primary tabular-nums"
              data-testid="weather-temp"
            >
              {tempLabel}C
            </p>
            <p className="mt-1.5 text-sm text-secondary sm:truncate">
              <span data-testid="weather-condition">{p.condition}</span>
              {" · "}
              <span data-testid="weather-location">{placeLabel}</span>
            </p>
          </div>
        </div>
        <ul className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-secondary sm:ml-auto">
          {p.humidity_pct != null && (
            <li className="inline-flex items-center gap-1.5">
              <Droplets size={16} className="shrink-0" aria-hidden />
              Humidity {p.humidity_pct}%
            </li>
          )}
          {p.wind_kph != null && (
            <li className="inline-flex items-center gap-1.5">
              <Wind size={16} className="shrink-0" aria-hidden />
              Wind {Math.round(p.wind_kph)} km/h
            </li>
          )}
          {rain && (
            <li className="inline-flex items-center gap-1.5" data-testid="weather-rain">
              <CloudSunRain size={16} className="shrink-0" aria-hidden />
              {rain}
            </li>
          )}
        </ul>
      </div>

      <DryingAdvisor coords={coords} hourly={fc.data?.hourly} />
    </div>
  );
}

/** Compact shell — the topbar pill chrome. Same class set used by every state
 *  branch so loading/error/data don't shift the layout. */
function Shell({
  variant,
  testid,
  title,
  children,
}: {
  variant: Variant;
  testid: string;
  title?: string;
  children: React.ReactNode;
}) {
  if (variant === "expanded") {
    return (
      <div data-testid={testid} className="card flex items-center gap-3">
        {children}
      </div>
    );
  }
  return (
    <div
      data-testid={testid}
      title={title}
      className="inline-flex items-center gap-1.5 px-2 sm:px-2.5 py-1.5 rounded-xl bg-white/60 dark:bg-slate-800/60 ring-1 ring-soft text-secondary"
    >
      {children}
    </div>
  );
}
