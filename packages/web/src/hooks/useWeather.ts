import { useQuery } from "@tanstack/react-query";
import { weatherService } from "../services/WeatherService";
import type { Coords } from "./useGeolocation";

export type WeatherConditionCode =
  | "clear" | "mostly_clear" | "partly_cloudy" | "mostly_cloudy" | "cloudy"
  | "fog" | "windy" | "wind_rain"
  | "rain_light" | "rain" | "rain_heavy" | "rain_chance" | "rain_scattered"
  | "snow_light" | "snow" | "snow_heavy" | "snow_chance"
  | "sleet" | "hail" | "thunderstorm"
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
