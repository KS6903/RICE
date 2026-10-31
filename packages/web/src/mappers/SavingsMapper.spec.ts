import { describe, expect, it } from "vitest";
import { batchFlags, blend, payableWeight } from "./SavingsMapper";

describe("payableWeight", () => {
  it("takes impurities off, then the water above 14%: the server's worked example", () => {
    expect(payableWeight(1000, 18, 2)).toBeCloseTo(934.419, 3);
  });

  it("has nothing to take off dry, clean palay", () => {
    expect(payableWeight(1000, 14, 0)).toBeNull();
    expect(payableWeight(1000, null, null)).toBeNull();
  });

  it("leaves drier palay as weighed, apart from its impurities", () => {
    expect(payableWeight(1000, 12, 1)).toBe(990);
  });
});

describe("blend", () => {
  it("hits a 5% and a 25% broken contract: the server's worked examples", () => {
    expect(blend(2, 100, 5, 1000)?.streamPct).toBeCloseTo(3.061, 3);
    expect(blend(2, 100, 25, 1000)?.streamKg).toBeCloseTo(234.694, 3);
  });

  it("says when the bins can't make the grade", () => {
    expect(blend(10, 100, 5, 1000)).toBeNull();
    expect(blend(5, 5, 5, 1000)).toBeNull();
  });
});

describe("batchFlags", () => {
  it("doesn't call kilos unaccounted until by-products are recorded", () => {
    const flags = batchFlags({
      inputs: [{ input_weight_kg: 1000 }],
      outputs: [{ output_type: "milled_rice", output_weight_kg: 650 }],
    });
    expect(flags.unaccountedKg).toBeNull();
    expect(flags.overUnaccounted).toBe(false);
  });

  it("flags low recovery, high brokens and missing kilos", () => {
    const flags = batchFlags({
      inputs: [{ input_weight_kg: 1000 }],
      outputs: [
        { output_type: "milled_rice", output_weight_kg: 600, broken_rice_pct: 12 },
        { output_type: "ipa", output_weight_kg: 200 },
        { output_type: "darak", output_weight_kg: 90 },
      ],
    });
    expect(flags).toMatchObject({
      lowRecovery: true,
      highBroken: true,
      unaccountedKg: 110,
      overUnaccounted: true,
    });
  });
});
