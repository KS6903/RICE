import { useEffect, useMemo, useState } from "react";
import type { Coords } from "./useGeolocation";
import type { HourlyForecast } from "./useWeather";
import { useDryingAdvisory } from "./useDryingAdvisory";
import { dryingAdvice, type DryingAdvice } from "../utils/dryingAdvice";

export type DryingBanner = DryingAdvice & { source: "ai" | "forecast" };

const HOUR_MS = 60 * 60 * 1000;

type Saved = { banner: DryingBanner; savedAt: number };

const storageKey = (coords: Coords | null) =>
  `oraiza:drying-advice:${coords ? `${coords.lat.toFixed(2)},${coords.lon.toFixed(2)}` : "here"}`;

function readSaved(key: string): Saved | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const saved = JSON.parse(raw) as Saved;
    if (!saved?.banner?.headline || Date.now() - saved.savedAt >= HOUR_MS) return null;
    return saved;
  } catch {
    return null;
  }
}

function writeSaved(key: string, saved: Saved) {
  try {
    localStorage.setItem(key, JSON.stringify(saved));
  } catch {
    // Storage blocked: it still holds for as long as the page stays open.
  }
}

/**
 * The drying advice line under the weather. The AI advisor's answer when it
 * has one; otherwise advice worked out from the hourly forecast, so the line
 * never just says the advisor is unavailable. Null only when neither exists.
 *
 * Whatever is shown is kept for an hour, in this browser, so a reload shows
 * the same advice instead of asking again. After the hour it's worked out
 * afresh, also while the page stays open.
 */
export function useDryingBanner(
  coords: Coords | null,
  hourly: HourlyForecast[] | undefined,
): DryingBanner | null {
  const key = storageKey(coords);
  const [saved, setSaved] = useState<Saved | null>(() => readSaved(key));

  // Another place: read what was kept for it.
  useEffect(() => setSaved(readSaved(key)), [key]);

  // Work it out afresh once the hour is up, even if nobody reloads.
  useEffect(() => {
    if (!saved) return;
    const timer = window.setTimeout(
      () => setSaved(null),
      Math.max(0, saved.savedAt + HOUR_MS - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [saved]);

  const ai = useDryingAdvisory(coords, { enabled: saved === null });

  const fresh = useMemo<DryingBanner | null>(() => {
    if (ai.data) {
      return {
        verdict: ai.data.verdict,
        headline: ai.data.headline,
        detail: ai.data.reasoning,
        source: "ai",
      };
    }
    const fromForecast = hourly ? dryingAdvice(hourly) : null;
    return fromForecast ? { ...fromForecast, source: "forecast" } : null;
  }, [ai.data, hourly]);

  // Keep it for the hour once the AI has answered or given up, so its answer,
  // not the stand-in shown while it thinks, is what gets kept.
  useEffect(() => {
    if (saved || !fresh || ai.isFetching) return;
    const next = { banner: fresh, savedAt: Date.now() };
    writeSaved(key, next);
    setSaved(next);
  }, [saved, fresh, ai.isFetching, key]);

  return saved?.banner ?? fresh;
}
