import { describe, expect, it } from "vitest";
import { parseScaleLine, settled } from "./scale";

describe("parseScaleLine", () => {
  it("reads the common indicator formats", () => {
    expect(parseScaleLine("ST,GS,+  12450 kg")).toEqual({ kg: 12450, stable: true });
    expect(parseScaleLine("=0012450")).toEqual({ kg: 12450, stable: true });
    expect(parseScaleLine("12.45 t")).toEqual({ kg: 12450, stable: true });
    expect(parseScaleLine("1000 lb")).toEqual({ kg: 453.592, stable: true });
  });

  it("marks a weight that is still settling", () => {
    expect(parseScaleLine("US,GS,+  12380 kg")?.stable).toBe(false);
  });

  it("ignores what holds no weight", () => {
    expect(parseScaleLine("HELLO")).toBeNull();
    expect(parseScaleLine("ST,GS,-   20 kg")).toBeNull();
  });
});

describe("settled", () => {
  const at = (kg: number, stable = true) => ({ kg, stable });

  it("waits for the same stable weight three times running", () => {
    expect(settled([at(100), at(100)])).toBeNull();
    expect(settled([at(90), at(100), at(100), at(100)])).toBe(100);
    expect(settled([at(100), at(100), at(100, false)])).toBeNull();
    expect(settled([at(100), at(101), at(100)])).toBeNull();
  });

  it("doesn't take an empty deck for a weight", () => {
    expect(settled([at(0), at(0), at(0)])).toBeNull();
  });
});
