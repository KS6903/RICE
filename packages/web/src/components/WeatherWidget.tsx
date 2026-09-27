import { Cloud, Loader2, MapPin, Droplets } from "lucide-react";
import { useActiveLocation } from "../hooks/useActiveLocation";
import { useWeather, useForecast } from "../hooks/useWeather";
import { WEATHER_ICONS as ICONS, weatherIconClass as iconClass } from "./weatherIcons";
import DryingAdvisor from "./DryingAdvisor";

type Variant = "compact" | "expanded";

export default function WeatherWidget({ variant = "compact" }: { variant?: Variant }) {
  // Source-of-truth resolver: saved default > browser GPS > backend IP fallback.
  // The user's manually-saved location wins so what they pinned follows them
  // across every device they log in from.
  const active = useActiveLocation();
  const coords =
    active.lat != null && active.lon != null ? { lat: active.lat, lon: active.lon } : null;
  const w = useWeather(coords);
  // Today's prediction (high/low + rain chance) for the expanded card only — the
  // compact top-bar pill doesn't show it, so skip the fetch there.
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
  const today = fc.data?.daily?.[0];

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

  // Expanded dashboard card
  return (
    <div
      data-testid="weather-widget"
      className="card relative overflow-hidden flex items-center gap-4"
    >
      <div
        className="absolute -top-10 -right-10 h-32 w-32 rounded-full bg-sky-300/20 dark:bg-sky-500/10 blur-2xl pointer-events-none"
        aria-hidden
      />
      <div className="shrink-0 h-16 w-16 rounded-2xl ring-1 ring-slate-200 dark:ring-slate-700 grid place-items-center bg-white/60 dark:bg-slate-800/60">
        <Icon size={32} className={tint} data-testid="weather-icon" />
      </div>

      {/* Today's prediction — high/low + rain chance, sitting beside the
          current reading on the left. */}
      {today && (
        <div
          className="relative shrink-0 self-stretch flex flex-col justify-center pr-4 mr-1 border-r border-soft"
          data-testid="weather-today"
        >
          <p className="text-xs font-bold uppercase tracking-wide text-muted">Today</p>
          <p className="text-2xl font-extrabold text-primary tabular-nums mt-0.5 leading-none">
            {today.temp_max_c != null ? `${Math.round(today.temp_max_c)}°` : "—"}
            <span className="text-muted font-semibold text-lg">
              {" "}
              / {today.temp_min_c != null ? `${Math.round(today.temp_min_c)}°` : "—"}
            </span>
          </p>
          {today.precip_pct != null && today.precip_pct > 0 && (
            <p className="text-sm font-semibold text-sky-500 inline-flex items-center gap-1 mt-1.5">
              <Droplets size={14} /> {today.precip_pct}% rain
            </p>
          )}
          <p className="text-xs text-muted truncate max-w-[10rem] mt-1">{today.condition}</p>
        </div>
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <p
            className="text-3xl font-extrabold text-primary tabular-nums leading-none"
            data-testid="weather-temp"
          >
            {tempLabel}
            <span className="text-base font-semibold text-secondary ml-0.5">C</span>
          </p>
          <p
            className="text-sm font-semibold text-secondary truncate"
            data-testid="weather-condition"
          >
            {p.condition}
          </p>
        </div>
        <p
          className="text-xs text-muted mt-1 inline-flex items-center gap-1"
          data-testid="weather-location"
        >
          <MapPin size={11} />
          {placeLabel} · {p.provider}
        </p>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-muted tabular-nums">
          {p.feels_like_c != null && <span>Feels {Math.round(p.feels_like_c)}°C</span>}
          {p.humidity_pct != null && <span>Humidity {p.humidity_pct}%</span>}
          {p.wind_kph != null && <span>Wind {Math.round(p.wind_kph)} km/h</span>}
        </div>
      </div>

      {/* Agentic AI palay-drying advisor (Enterprise-only) */}
      <DryingAdvisor coords={coords} />
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
      className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-white/60 dark:bg-slate-800/60 ring-1 ring-soft text-secondary"
    >
      {children}
    </div>
  );
}
