// Shared weather icon + tint mapping, used by both the current-conditions
// WeatherWidget and the WeatherForecast (hourly/daily) panel so the visual
// language stays identical across the dashboard.
import {
  Sun,
  Cloud,
  CloudSun,
  Cloudy,
  CloudFog,
  CloudRain,
  CloudDrizzle,
  CloudLightning,
  CloudSnow,
  CloudHail,
  Wind,
} from "lucide-react";
import type { WeatherConditionCode } from "../hooks/useWeather";

export const WEATHER_ICONS: Record<WeatherConditionCode, React.ElementType> = {
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
export function weatherIconClass(code: WeatherConditionCode, isDay: boolean): string {
  if (code === "clear" || code === "mostly_clear") {
    return isDay ? "text-amber-500" : "text-indigo-400";
  }
  if (code.startsWith("rain") || code.startsWith("wind_rain")) return "text-sky-500";
  if (code.startsWith("snow") || code === "sleet" || code === "hail") return "text-cyan-400";
  if (code === "thunderstorm") return "text-violet-500";
  if (code === "fog") return "text-slate-400";
  return "text-slate-500 dark:text-slate-300";
}
