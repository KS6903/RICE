import { describe, expect, it } from "vitest";
import { TWO_MONTHS_FREE, annualPrice } from "./planPricing";

describe("annualPrice", () => {
  it("is 12 months less the discount, to the nearest peso", () => {
    expect(annualPrice(1000, 15)).toBe(10200);
    expect(annualPrice(999, 12.5)).toBe(10490);
    expect(annualPrice(1000, 0)).toBe(12000);
    expect(annualPrice(0, 50)).toBe(0);
  });

  it("lands on 10x monthly for two months free, like the seeded plans", () => {
    expect(annualPrice(699, TWO_MONTHS_FREE)).toBe(6990);
    expect(annualPrice(1499, TWO_MONTHS_FREE)).toBe(14990);
    expect(annualPrice(4999, TWO_MONTHS_FREE)).toBe(49990);
  });
});
