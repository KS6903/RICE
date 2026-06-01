import {
  Sun, Cloud, CloudSun, Cloudy, CloudFog, CloudRain, CloudDrizzle,
  CloudLightning, CloudSnow, CloudHail, Wind, Loader2, MapPin,
} from "lucide-react";
import { useActiveLocation } from "../hooks/useActiveLocation";
import { useWeather, type WeatherConditionCode } from "../hooks/useWeather";

type Variant = "compact" | "expanded";

const ICONS: Record<WeatherConditionCode, React.ElementType> = {
  clear: Sun,
  mostly_clear: Sun,
  partly_cloudy: CloudSun,
  mostly_cloudy: Cloudy,
  cloudy: Cloud,
  fog: CloudFog,
  windy: Wind,
  wind_rain: Wind,
  rain_light: CloudDrizzle,
  rain_chance: CloudDrizzle,
  rain_scattered: CloudRain,
  rain: CloudRain,
  rain_heavy: CloudRain,
  snow_light: CloudSnow,
  snow: CloudSnow,
  snow_heavy: CloudSnow,
  snow_chance: CloudSnow,
  sleet: CloudSnow,
  hail: CloudHail,
  thunderstorm: CloudLightning,
  unknown: Cloud,
};

/** Pick a tint so the icon reads at a glance — warm for clear, blue for rain,
 *  violet for thunder, slate for everything else. */
function iconClass(code: WeatherConditionCode, isDay: boolean): string {
  if (code === "clear" || code === "mostly_clear") {
    return isDay ? "text-amber-500" : "text-indigo-400";
  }
  if (code.startsWith("rain") || code.startsWith("wind_rain")) return "text-sky-500";
  if (code.startsWith("snow") || code === "sleet" || code === "hail") return "text-cyan-400";
  if (code === "thunderstorm") return "text-violet-500";
  if (code === "fog") return "text-slate-400";
  return "text-slate-500 dark:text-slate-300";
}

export default function WeatherWidget({ variant = "compact" }: { variant?: Variant }) {
  // Source-of-truth resolver: saved default > browser GPS > backend IP fallback.
  // The user's manually-saved location wins so what they pinned follows them
  // across every device they log in from.
  const active = useActiveLocation();
  const coords = active.lat != null && active.lon != null ? { lat: active.lat, lon: active.lon } : null;
  const w = useWeather(coords);

  // ── Loading state ──
  if (w.isLoading) {
    return (
      <Shell variant={variant} testid="weather-widget">
        <Loader2 size={variant === "compact" ? 14 : 22} className="animate-spin text-muted shrink-0" />
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
  const placeLabel = active.source === "saved" && active.label
    ? active.label
    : p.location.label ?? `${p.location.lat.toFixed(2)}, ${p.location.lon.toFixed(2)}`;

  if (variant === "compact") {
    return (
      <Shell
        variant="compact"
        testid="weather-widget"
        title={`${p.condition} · ${placeLabel} · feels like ${p.feels_like_c != null ? Math.round(p.feels_like_c) + "°C" : "—"} · ${p.provider}`}
      >
        <Icon size={16} className={`${tint} shrink-0`} data-testid="weather-icon" />
        <span className="text-sm font-semibold text-primary tabular-nums" data-testid="weather-temp">{tempLabel}C</span>
        <span className="hidden md:inline text-xs text-secondary truncate max-w-[8rem]" data-testid="weather-location">{placeLabel}</span>
      </Shell>
    );
  }

  // Expanded dashboard card
  return (
    <div
      data-testid="weather-widget"
      className="card relative overflow-hidden flex items-center gap-4"
    >
      <div className="absolute -top-10 -right-10 h-32 w-32 rounded-full bg-sky-300/20 dark:bg-sky-500/10 blur-2xl pointer-events-none" aria-hidden />
      <div className="shrink-0 h-14 w-14 rounded-2xl ring-1 ring-slate-200 dark:ring-slate-700 grid place-items-center bg-white/60 dark:bg-slate-800/60">
        <Icon size={28} className={tint} data-testid="weather-icon" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <p className="text-3xl font-extrabold text-primary tabular-nums leading-none" data-testid="weather-temp">
            {tempLabel}<span className="text-base font-semibold text-secondary ml-0.5">C</span>
          </p>
          <p className="text-sm font-semibold text-secondary truncate" data-testid="weather-condition">{p.condition}</p>
        </div>
        <p className="text-xs text-muted mt-1 inline-flex items-center gap-1" data-testid="weather-location">
          <MapPin size={11} />
          {placeLabel} · {p.provider}
        </p>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-muted tabular-nums">
          {p.feels_like_c != null && <span>Feels {Math.round(p.feels_like_c)}°C</span>}
          {p.humidity_pct != null && <span>Humidity {p.humidity_pct}%</span>}
          {p.wind_kph != null && <span>Wind {Math.round(p.wind_kph)} km/h</span>}
        </div>
      </div>
    </div>
  );
}

/** Compact shell — the topbar pill chrome. Same class set used by every state
 *  branch so loading/error/data don't shift the layout. */
function Shell({
  variant, testid, title, children,
}: {
  variant: Variant;
  testid: string;
  title?: string;
  children: React.ReactNode;
}) {
  if (variant === "expanded") {
    return <div data-testid={testid} className="card flex items-center gap-3">{children}</div>;
  }
  return (
    <div
      data-testid={testid}
      title={title}
      className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-white/60 dark:bg-slate-800/60 ring-1 ring-soft text-secondary"
    >
      {children}
    </div>
  );
}
