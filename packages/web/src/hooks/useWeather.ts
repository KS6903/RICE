import { useQuery } from "@tanstack/react-query";
import { weatherService } from "../services/WeatherService";
import type { Coords } from "./useGeolocation";

export type WeatherConditionCode =
  | "clear"
  | "mostly_clear"
  | "partly_cloudy"
  | "mostly_cloudy"
  | "cloudy"
  | "fog"
  | "windy"
  | "wind_rain"
  | "rain_light"
  | "rain"
  | "rain_heavy"
  | "rain_chance"
  | "rain_scattered"
  | "snow_light"
  | "snow"
  | "snow_heavy"
  | "snow_chance"
  | "sleet"
  | "hail"
  | "thunderstorm"
  | "unknown";

export type WeatherPayload = {
  provider: "google" | "open-meteo";
  temp_c: number | null;
  feels_like_c: number | null;
  humidity_pct: number | null;
  wind_kph: number | null;
  condition: string;
  condition_code: WeatherConditionCode;
  is_daytime: boolean;
  location: { lat: number; lon: number; label: string | null };
  fetched_at: string;
};

export type HourlyForecast = {
  time: string; // local ISO, e.g. "2026-06-15T13:00"
  temp_c: number | null;
  condition: string;
  condition_code: WeatherConditionCode;
  precip_pct: number | null;
  is_daytime: boolean;
};

export type DailyForecast = {
  date: string; // local date, e.g. "2026-06-15"
  temp_max_c: number | null;
  temp_min_c: number | null;
  condition: string;
  condition_code: WeatherConditionCode;
  precip_pct: number | null;
};

export type ForecastPayload = {
  provider: "open-meteo";
  location: { lat: number; lon: number; label: string | null };
  hourly: HourlyForecast[];
  daily: DailyForecast[];
  fetched_at: string;
};

/** Fetch the client's local weather.
 *
 *  When `coords` are supplied, the backend trusts them (precise — browser
 *  GPS). When `null`, the backend resolves location from the request's
 *  public IP (~city-level accuracy). Either path, the same 10-minute cache
 *  window applies, so navigating between tabs never re-fires upstream. */
export function useWeather(coords: Coords | null) {
  const lat = coords ? Math.round(coords.lat * 100) / 100 : null;
  const lon = coords ? Math.round(coords.lon * 100) / 100 : null;
  return useQuery<WeatherPayload>({
    queryKey: ["weather", lat, lon],
    queryFn: () => weatherService.get(coords),
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}

/** Fetch the hourly (next 24h) + daily (7-day) forecast for `coords` (or the
 *  IP-resolved location when null). Cached 30 min server-side; we mirror that
 *  staleness client-side so tab switches don't re-fetch.
 *
 *  `enabled` lets callers that only sometimes need the forecast (e.g. the
 *  compact top-bar weather pill) skip the request. React Query dedupes by key,
 *  so multiple enabled consumers still share one fetch. */
export function useForecast(coords: Coords | null, opts: { enabled?: boolean } = {}) {
  const lat = coords ? Math.round(coords.lat * 100) / 100 : null;
  const lon = coords ? Math.round(coords.lon * 100) / 100 : null;
  return useQuery<ForecastPayload>({
    queryKey: ["weather-forecast", lat, lon],
    queryFn: () => weatherService.getForecast(coords),
    staleTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
    enabled: opts.enabled ?? true,
  });
}
