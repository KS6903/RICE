// Shared weather icon + tint mapping, used by the current-conditions
// WeatherWidget and its hourly and daily strips so the visual language stays
// identical across the dashboard.
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
  CloudMoon,
  CloudMoonRain,
  CloudSunRain,
  Moon,
  Wind,
} from "lucide-react";
import type { WeatherConditionCode } from "../hooks/useWeather";
import { currentLanguage, DEFAULT_LANGUAGE, t } from "../i18n";

/** What each condition is called, for languages other than English. */
const CONDITION_NAMES: Record<WeatherConditionCode, string> = {
  clear: t("Clear"),
  mostly_clear: t("Mostly clear"),
  partly_cloudy: t("Partly cloudy"),
  mostly_cloudy: t("Mostly cloudy"),
  cloudy: t("Cloudy"),
  fog: t("Fog"),
  windy: t("Windy"),
  wind_rain: t("Wind and rain"),
  rain_light: t("Light rain"),
  rain_chance: t("Chance of rain"),
  rain_scattered: t("Scattered showers"),
  rain: t("Rain"),
  rain_heavy: t("Heavy rain"),
  snow_light: t("Light snow"),
  snow: t("Snow"),
  snow_heavy: t("Heavy snow"),
  snow_chance: t("Chance of snow"),
  sleet: t("Sleet"),
  hail: t("Hail"),
  thunderstorm: t("Thunderstorm"),
  unknown: t("Unknown"),
};

/** The condition in words. In English, the weather service's own words
 *  ("Light rain"); in another language, the condition's name in it. */
export function conditionText(code: WeatherConditionCode, providerText: string): string {
  if (currentLanguage().code === DEFAULT_LANGUAGE) return providerText;
  return CONDITION_NAMES[code] ?? providerText;
}

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

/** The icon for what the sky is doing now: a moon after dark, a sun behind the
 *  cloud or the rain by day. Everything else looks the same day and night. */
export function weatherIcon(code: WeatherConditionCode, isDay: boolean): React.ElementType {
  if (code === "clear" || code === "mostly_clear") return isDay ? Sun : Moon;
  if (code === "partly_cloudy") return isDay ? CloudSun : CloudMoon;
  if (code === "rain_chance" || code === "rain_scattered") {
    return isDay ? CloudSunRain : CloudMoonRain;
  }
  return WEATHER_ICONS[code] ?? Cloud;
}

/** Pick a tint so the icon reads at a glance — warm for clear, blue for rain,
 *  violet for thunder, slate for everything else. */
export function weatherIconClass(code: WeatherConditionCode, isDay: boolean): string {
  if (code === "clear" || code === "mostly_clear") {
    return isDay ? "text-amber-500" : "text-indigo-400";
  }
  // Sun behind a cloud: the sun still sets the colour by day.
  if (code === "partly_cloudy" && isDay) return "text-amber-500";
  if (code.startsWith("rain") || code.startsWith("wind_rain")) return "text-sky-500";
  if (code.startsWith("snow") || code === "sleet" || code === "hail") return "text-cyan-400";
  if (code === "thunderstorm") return "text-violet-500";
  if (code === "fog") return "text-slate-400";
  return "text-slate-500 dark:text-slate-300";
}
