// Palay drying advice worked out from the hourly forecast: when rain is likely,
// and how long the palay can stay out before it. No AI involved, so it works
// whenever the forecast does; the dashboard uses it when the AI advisor has no
// answer.
import type { HourlyForecast } from "../hooks/useWeather";
import { currentLocale, t } from "../i18n";

/** A slot counts as rainy from this chance of rain up. */
export const RAIN_LIKELY_PCT = 50;
/** Spread palay once the morning dew is off, around this hour. */
const SPREAD_HOUR = 9;
/** Fewer dry daylight hours than this before rain isn't worth spreading for. */
const MIN_DRYING_HOURS = 3;
/** From this many dry hours, it's a good drying day rather than a short window. */
const GOOD_DRYING_HOURS = 5;

export type DryingVerdict = "good" | "caution" | "poor";

export type DryingAdvice = {
  verdict: DryingVerdict;
  /** Bold, short. */
  headline: string;
  /** One sentence on what to do. */
  detail: string;
};

const rainy = (h: HourlyForecast) => (h.precip_pct ?? 0) >= RAIN_LIKELY_PCT;
const hourOf = (h: HourlyForecast) => Number(h.time.slice(11, 13));
const dateOf = (h: HourlyForecast) => h.time.slice(0, 10);

/** "4 PM", "12 PM", "9 AM" from a local ISO hour like "2026-10-22T16:00", the
 *  way the language on screen writes an hour. */
export function hourLabel(time: string): string {
  const h = Number(time.slice(11, 13));
  return new Intl.DateTimeFormat(currentLocale(), { hour: "numeric" })
    .format(new Date(2000, 0, 1, h))
    .replace(/\u202f/g, " ");
}

/** The short line beside humidity and wind: when rain is next likely, within
 *  the forecast's 24 hours. The first slot is the current hour. */
export function rainOutlook(hourly: HourlyForecast[]): string | null {
  if (hourly.length === 0) return null;
  const today = dateOf(hourly[0]);
  const next = hourly.find(rainy);
  if (!next) return t("No rain expected");
  if (next === hourly[0]) return t("Rain likely now");
  if (dateOf(next) === today)
    return t("Rain likely after {{time}}", { time: hourLabel(next.time) });
  return t("Rain likely tomorrow from {{time}}", { time: hourLabel(next.time) });
}

/** Whether to spread palay, and until when. Looks at today's remaining
 *  daylight, or tomorrow's once today's is nearly gone. */
export function dryingAdvice(hourly: HourlyForecast[]): DryingAdvice | null {
  if (hourly.length === 0) return null;
  const now = hourly[0];

  if (rainy(now)) {
    const dryAgain = hourly.find((h) => !rainy(h) && h.is_daytime && dateOf(h) === dateOf(now));
    return {
      verdict: "poor",
      headline: t("Rain likely now."),
      detail: dryAgain
        ? t("Keep the palay covered. It may clear by {{time}}.", { time: hourLabel(dryAgain.time) })
        : t("Keep the palay covered today."),
    };
  }

  // Today, if at least a few daylight hours are left; otherwise tomorrow.
  const daylightToday = hourly.filter((h) => h.is_daytime && dateOf(h) === dateOf(now));
  const onToday = daylightToday.length >= MIN_DRYING_HOURS;
  const day = onToday
    ? daylightToday
    : hourly.filter((h) => h.is_daytime && dateOf(h) !== dateOf(now));
  if (day.length === 0) return null;

  // From when spreading makes sense: 9 AM, or now if that's already past
  // (the forecast starts at the current hour).
  const usable = day.filter((h) => hourOf(h) >= SPREAD_HOUR);
  if (usable.length === 0) return null;
  const rainAt = usable.findIndex(rainy);
  const firstRain = rainAt >= 0 ? usable[rainAt] : null;
  // With rain coming, stop an hour before it, to leave time to bring it in.
  const lastOut = firstRain ? usable[rainAt - 1] : null;
  const hours = firstRain ? rainAt - 1 : usable.length;
  // Whole sentences, so each language can say them its own way.
  const spreadNow = onToday && hourOf(now) >= SPREAD_HOUR;
  const beforeRain = spreadNow
    ? t("Spread the palay now and bring it in before the rain.")
    : t("Spread the palay by 9 AM and bring it in before the rain.");
  const beforeDark = spreadNow
    ? t("Spread the palay now and bring it in before dark.")
    : t("Spread the palay by 9 AM and bring it in before dark.");

  if (hours < MIN_DRYING_HOURS || (firstRain && !lastOut)) {
    return {
      verdict: "poor",
      headline: onToday ? t("Not a good drying day today.") : t("Not a good drying day tomorrow."),
      detail: firstRain
        ? t("Rain is likely from {{time}}. Keep the palay covered.", {
            time: hourLabel(firstRain.time),
          })
        : t("Too little daylight left. Keep the palay covered."),
    };
  }
  if (firstRain && lastOut) {
    const short = hours < GOOD_DRYING_HOURS;
    const time = hourLabel(lastOut.time);
    let headline: string;
    if (short)
      headline = onToday
        ? t("Only a short drying window, until {{time}}.", { time })
        : t("Only a short drying window, until {{time}} tomorrow.", { time });
    else
      headline = onToday
        ? t("Good drying weather until {{time}}.", { time })
        : t("Good drying weather until {{time}} tomorrow.", { time });
    return { verdict: short ? "caution" : "good", headline, detail: beforeRain };
  }
  return {
    verdict: "good",
    headline: onToday ? t("Good drying weather today.") : t("Good drying weather tomorrow."),
    detail: beforeDark,
  };
}
