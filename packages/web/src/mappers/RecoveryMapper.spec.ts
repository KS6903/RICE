import { describe, expect, it } from "vitest";
import {
  computeRecovery,
  convertAmount,
  formatWeight,
  parseAmount,
  recoveryGap,
  recoveryProblem,
  toKg,
  type RecoveryInput,
} from "./RecoveryMapper";

const sample = (over: Partial<RecoveryInput> = {}): RecoveryInput => ({
  sampleKg: 100,
  moisturePct: null,
  milledKg: 65,
  headKg: null,
  huskKg: null,
  branKg: null,
  ...over,
});

describe("computeRecovery", () => {
  it("is the milled rice over the palay", () => {
    const r = computeRecovery(sample());
    expect(r?.recoveryPct).toBeCloseTo(65, 5);
    expect(r?.riceKgPerCavan).toBeCloseTo(32.5, 5);
  });

  it("gives the head rice against the palay and against the milled rice, and the rest is broken", () => {
    const r = computeRecovery(sample({ headKg: 52 }));
    expect(r?.headOfPalayPct).toBeCloseTo(52, 5);
    expect(r?.headOfMilledPct).toBeCloseTo(80, 5);
    expect(r?.brokenOfMilledPct).toBeCloseTo(20, 5);
  });

  it("leaves what wasn't weighed out", () => {
    const r = computeRecovery(sample());
    expect(r).toMatchObject({
      headOfPalayPct: null,
      headOfMilledPct: null,
      brokenOfMilledPct: null,
      huskPct: null,
      branPct: null,
      notAccountedPct: null,
      recoveryAt14Pct: null,
    });
  });

  it("gives the husk and bran, and what's unaccounted for only when both were weighed", () => {
    expect(computeRecovery(sample({ huskKg: 20 }))).toMatchObject({
      huskPct: 20,
      notAccountedPct: null,
    });
    const r = computeRecovery(sample({ huskKg: 20, branKg: 10 }));
    expect(r?.huskPct).toBeCloseTo(20, 5);
    expect(r?.branPct).toBeCloseTo(10, 5);
    expect(r?.notAccountedPct).toBeCloseTo(5, 5);
  });

  it("weighs palay wetter than 14% down to 14% by its dry matter", () => {
    // 100 kg at 25% moisture is 100 × 75 ÷ 86 = 87.2 kg at 14%.
    const r = computeRecovery(sample({ moisturePct: 25, milledKg: 56.7 }));
    expect(r?.recoveryPct).toBeCloseTo(56.7, 5);
    expect(r?.recoveryAt14Pct).toBeCloseTo((56.7 / ((100 * 75) / 86)) * 100, 5);
  });

  it("leaves palay at or under 14% as weighed", () => {
    expect(computeRecovery(sample({ moisturePct: 14 }))?.recoveryAt14Pct).toBeNull();
    expect(computeRecovery(sample({ moisturePct: 12 }))?.recoveryAt14Pct).toBeNull();
  });

  it("needs the sample and the milled rice", () => {
    expect(computeRecovery(sample({ sampleKg: null }))).toBeNull();
    expect(computeRecovery(sample({ sampleKg: 0 }))).toBeNull();
    expect(computeRecovery(sample({ milledKg: null }))).toBeNull();
    expect(computeRecovery(sample({ milledKg: 0 }))).toBeNull();
  });

  it("gives nothing for weights that can't be true", () => {
    expect(computeRecovery(sample({ milledKg: 101 }))).toBeNull();
    expect(computeRecovery(sample({ headKg: 66 }))).toBeNull();
  });
});

describe("recoveryProblem", () => {
  it("names what can't be true", () => {
    expect(recoveryProblem(sample())).toBeNull();
    expect(recoveryProblem(sample({ milledKg: 101 }))).toBe("rice-over-palay");
    expect(recoveryProblem(sample({ headKg: 66 }))).toBe("head-over-rice");
    expect(recoveryProblem(sample({ huskKg: 101 }))).toBe("part-over-palay");
    expect(recoveryProblem(sample({ branKg: 101 }))).toBe("part-over-palay");
  });

  it("says nothing until there is a sample and milled rice to compare", () => {
    expect(recoveryProblem(sample({ sampleKg: null, milledKg: 500 }))).toBeNull();
    expect(recoveryProblem(sample({ milledKg: null, headKg: 500 }))).toBeNull();
  });
});

describe("recoveryGap", () => {
  it("compares with the variety's own recovery", () => {
    const gap = recoveryGap(63, 66);
    expect(gap.usual).toBe(66);
    expect(gap.points).toBeCloseTo(-3, 5);
  });

  it("falls back to the mill's 65% for a variety without one", () => {
    expect(recoveryGap(67, null)).toEqual({ usual: 65, points: 2 });
    expect(recoveryGap(67, 0)).toEqual({ usual: 65, points: 2 });
  });
});

describe("weights in kilos or grams", () => {
  it("turns an amount into kilos to the milligram", () => {
    expect(toKg(50, "kg")).toBe(50);
    expect(toKg(50, "g")).toBe(0.05);
    expect(toKg(32.5, "g")).toBe(0.0325);
    // No float noise for the server to refuse: 123.4 g is 0.1234 kg, not 0.12340000000000001.
    expect(toKg(123.4, "g")).toBe(0.1234);
  });

  it("gives the same recovery whichever unit the weights were typed in", () => {
    const inKg = computeRecovery(sample({ sampleKg: 0.05, milledKg: 0.0325 }));
    const inGrams = computeRecovery(sample({ sampleKg: toKg(50, "g"), milledKg: toKg(32.5, "g") }));
    expect(inGrams?.recoveryPct).toBeCloseTo(65, 5);
    expect(inGrams?.recoveryPct).toBeCloseTo(inKg?.recoveryPct ?? 0, 9);
  });

  it("shows a typed amount again in the other unit, the weight unchanged", () => {
    expect(convertAmount("100", "kg", "g")).toBe("100000");
    expect(convertAmount("32.5", "g", "kg")).toBe("0.0325");
    expect(convertAmount("0.1", "kg", "g")).toBe("100");
    expect(convertAmount("12.3", "kg", "kg")).toBe("12.3");
  });

  it("leaves a blank or unreadable amount alone when the unit changes", () => {
    expect(convertAmount("", "kg", "g")).toBe("");
    expect(convertAmount("abc", "g", "kg")).toBe("abc");
  });

  it("reads kilos under a kilo as grams", () => {
    expect(formatWeight("100.000")).toBe("100 kg");
    expect(formatWeight(1)).toBe("1 kg");
    expect(formatWeight("0.0325")).toBe("32.5 g");
    expect(formatWeight("0.05")).toBe("50 g");
    expect(formatWeight(null)).toBe("0 kg");
  });
});

describe("parseAmount", () => {
  it("reads a number, and nothing for a blank or a non-number", () => {
    expect(parseAmount("32.5")).toBe(32.5);
    expect(parseAmount("0")).toBe(0);
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("  ")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
    expect(parseAmount("-5")).toBeNull();
  });
});
