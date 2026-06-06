import { describe, it, expect } from "vitest";
import { MillingMapper } from "./MillingMapper";

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
