import { describe, it, expect } from "vitest";
import { MillingMapper, estimateOutputs } from "./MillingMapper";

describe("MillingMapper.summarizeBatch", () => {
  it("sums inputs, finds milled output, and computes recovery", () => {
    const batch = {
      inputs: [{ input_weight_kg: "600" }, { input_weight_kg: 400 }],
      outputs: [
        { output_type: "milled_rice", output_weight_kg: "650" },
        { output_type: "ipa", output_weight_kg: "200" },
      ],
    };
    const s = MillingMapper.summarizeBatch(batch);
    expect(s.totalInput).toBe(1000);
    expect(s.milledKg).toBe(650);
    expect(s.recovery).toBeCloseTo(65, 5);
  });

  it("returns null recovery/milledKg when there's no milled output", () => {
    const s = MillingMapper.summarizeBatch({ inputs: [{ input_weight_kg: 100 }], outputs: [] });
    expect(s.totalInput).toBe(100);
    expect(s.milledKg).toBeNull();
    expect(s.recovery).toBeNull();
  });

  it("handles missing inputs/outputs", () => {
    const s = MillingMapper.summarizeBatch({});
    expect(s).toEqual({ totalInput: 0, milledKg: null, recovery: null });
  });
});

describe("estimateOutputs", () => {
  it("uses 65% recovery, 20% hull and 10% bran by default", () => {
    const e = estimateOutputs([{ input_weight_kg: "1000" }]);
    expect(e).toMatchObject({
      palayKg: 1000,
      adjustedKg: 1000,
      milled_rice: 650,
      ipa: 200,
      darak: 100,
    });
    expect(e.lossKg).toBe(50);
    expect(e.recoveryPct).toBeCloseTo(65, 5);
  });

  it("uses the variety's recovery and shrinks bran so the total stays within the palay", () => {
    const e = estimateOutputs([{ variety_id: "v1", input_weight_kg: 1000 }], { v1: 72 });
    expect(e.milled_rice).toBe(720);
    expect(e.ipa).toBe(200);
    expect(e.darak).toBe(80);
    expect(e.lossKg).toBe(0);
  });

  it("weighs wet palay down to 14% moisture but leaves dry palay alone", () => {
    const wet = estimateOutputs([{ input_weight_kg: 1000, moisture_content_pct: "20" }]);
    // 1000 × 80 / 86 = 930.2 kg at 14%; 65% of it is milled rice.
    expect(wet.adjustedKg).toBe(930.2);
    expect(wet.milled_rice).toBe(604.7);
    const dry = estimateOutputs([{ input_weight_kg: 1000, moisture_content_pct: 12 }]);
    expect(dry.adjustedKg).toBe(1000);
  });

  it("adds up several inputs and skips blank weights", () => {
    const e = estimateOutputs(
      [
        { variety_id: "a", input_weight_kg: 500 },
        { variety_id: "b", input_weight_kg: 500 },
        { input_weight_kg: "" },
      ],
      { a: 60, b: 70 },
    );
    expect(e.palayKg).toBe(1000);
    expect(e.milled_rice).toBe(650);
    expect(e.darak).toBe(100);
  });

  it("is empty with no palay", () => {
    const e = estimateOutputs([]);
    expect(e.milled_rice).toBe(0);
    expect(e.recoveryPct).toBeNull();
  });
});
