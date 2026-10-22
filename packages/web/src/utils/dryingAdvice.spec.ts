import { describe, expect, it } from "vitest";
import type { HourlyForecast } from "../hooks/useWeather";
import { dryingAdvice, hourLabel, rainOutlook } from "./dryingAdvice";

/** 24 hourly slots from `start` ("2026-10-22T08:00"), daylight 6 AM to 5 PM,
 *  with the given chance of rain from the hours in `rainFrom` onward. */
function forecast(start: string, rain: Record<number, number> = {}): HourlyForecast[] {
  const t0 = new Date(`${start}:00Z`).getTime();
  return Array.from({ length: 24 }, (_, i) => {
    const iso = new Date(t0 + i * 3600_000).toISOString().slice(0, 16);
    const hour = Number(iso.slice(11, 13));
    const fromHour = Object.keys(rain)
      .map(Number)
      .filter((h) => i >= h)
      .pop();
    return {
      time: iso,
      temp_c: 30,
      condition: "Partly cloudy",
      condition_code: "partly_cloudy",
      precip_pct: fromHour === undefined ? 10 : rain[fromHour],
      is_daytime: hour >= 6 && hour < 18,
    };
  });
}

describe("hourLabel", () => {
  it("reads a local hour the way people say it", () => {
    expect(hourLabel("2026-10-22T00:00")).toBe("12 AM");
    expect(hourLabel("2026-10-22T09:00")).toBe("9 AM");
    expect(hourLabel("2026-10-22T12:00")).toBe("12 PM");
    expect(hourLabel("2026-10-22T16:00")).toBe("4 PM");
  });
});

describe("rainOutlook", () => {
  it("says when rain is next likely", () => {
    // Slot 8 from 8 AM is 4 PM.
    expect(rainOutlook(forecast("2026-10-22T08:00", { 8: 70 }))).toBe("Rain likely after 4 PM");
    expect(rainOutlook(forecast("2026-10-22T08:00", { 0: 80 }))).toBe("Rain likely now");
    expect(rainOutlook(forecast("2026-10-22T20:00", { 12: 60 }))).toBe(
      "Rain likely tomorrow from 8 AM",
    );
    expect(rainOutlook(forecast("2026-10-22T08:00"))).toBe("No rain expected");
    expect(rainOutlook([])).toBeNull();
  });
});

describe("dryingAdvice", () => {
  it("rain at 4 PM: good until 3 PM, spread by 9, in before the rain", () => {
    expect(dryingAdvice(forecast("2026-10-22T07:00", { 9: 70 }))).toEqual({
      verdict: "good",
      headline: "Good drying weather until 3 PM.",
      detail: "Spread the palay by 9 AM and bring it in before the rain.",
    });
  });

  it("past 9 AM it says to spread now", () => {
    expect(dryingAdvice(forecast("2026-10-22T10:00"))?.detail).toBe(
      "Spread the palay now and bring it in before dark.",
    );
  });

  it("a dry day is good all day", () => {
    expect(dryingAdvice(forecast("2026-10-22T07:00"))).toMatchObject({
      verdict: "good",
      headline: "Good drying weather today.",
    });
  });

  it("only a few dry hours before rain is a short window", () => {
    // Rain from 2 PM: out 9 AM to 1 PM is four hours.
    expect(dryingAdvice(forecast("2026-10-22T07:00", { 7: 60 }))).toMatchObject({
      verdict: "caution",
      headline: "Only a short drying window, until 1 PM.",
    });
  });

  it("rain before mid-morning is not a drying day", () => {
    expect(dryingAdvice(forecast("2026-10-22T07:00", { 3: 60 }))).toMatchObject({
      verdict: "poor",
      headline: "Not a good drying day today.",
      detail: "Rain is likely from 10 AM. Keep the palay covered.",
    });
  });

  it("rain right now says to keep it covered", () => {
    expect(dryingAdvice(forecast("2026-10-22T10:00", { 0: 90, 3: 20 }))).toEqual({
      verdict: "poor",
      headline: "Rain likely now.",
      detail: "Keep the palay covered. It may clear by 1 PM.",
    });
  });

  it("in the evening it looks at tomorrow", () => {
    expect(dryingAdvice(forecast("2026-10-22T19:00"))).toMatchObject({
      verdict: "good",
      headline: "Good drying weather tomorrow.",
      detail: "Spread the palay by 9 AM and bring it in before dark.",
    });
  });

  it("no forecast, no advice", () => {
    expect(dryingAdvice([])).toBeNull();
  });
});
