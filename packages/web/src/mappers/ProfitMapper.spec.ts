import { describe, expect, it } from "vitest";
import {
  estimateByproducts,
  pricePlan,
  priceSteps,
  profitAt,
  type ProfitInput,
} from "./ProfitMapper";

// The worked example, also in backend/tests/unit/test_profit_service.py.
const lot: ProfitInput = {
  palayKg: 1000,
  palayPrice: 20,
  moisturePct: 14,
  recoveryPct: 65,
  otherCosts: 1000,
  byproducts: [
    { pct: 22.5, price: 1 },
    { pct: 9.5, price: 8 },
  ],
  targetMarginPct: 10,
  marketPrice: null,
};

describe("pricePlan", () => {
  it("works out the break-even, the target price and the profit", () => {
    const plan = pricePlan(lot)!;
    expect(plan.riceKg).toBeCloseTo(650);
    expect(plan.byproductIncome).toBeCloseTo(985);
    expect(plan.breakEven).toBeCloseTo(30.79, 2);
    expect(plan.targetPrice).toBe(34.5);
    expect(plan.recommendedPrice).toBe(34.5);
    expect(plan.profit).toBeCloseTo(2410);
    expect(plan.verdict).toBe("good");
  });

  it("doesn't push an exact half peso up to the next", () => {
    // ₱31.05 break-even ÷ 0.9 is exactly ₱34.50, whatever the floats say.
    const plan = pricePlan({
      ...lot,
      palayPrice: 31.05,
      otherCosts: 0,
      byproducts: [],
      recoveryPct: 100,
    })!;
    expect(plan.targetPrice).toBe(34.5);
  });

  it("sells at what the market pays when that's above break-even", () => {
    const plan = pricePlan({ ...lot, marketPrice: 42 })!;
    expect(plan.recommendedPrice).toBe(42);
    expect(plan.verdict).toBe("good");
    expect(plan.lossPerKg).toBeNull();
  });

  it("calls a profit under the target margin thin", () => {
    const plan = pricePlan({ ...lot, marketPrice: 32 })!;
    expect(plan.recommendedPrice).toBe(32);
    expect(plan.verdict).toBe("thin");
    expect(plan.profit).toBeGreaterThan(0);
  });

  it("calls it a losing game when the market pays no more than break-even, and says what would fix it", () => {
    const plan = pricePlan({ ...lot, marketPrice: 28 })!;
    expect(plan.verdict).toBe("losing");
    expect(plan.recommendedPrice).toBe(34.5);
    expect(plan.lossPerKg).toBeCloseTo(30.7923 - 28, 3);
    // Recovery that breaks even at ₱28, and the palay price that does.
    expect(plan.recoveryNeededPct).toBeCloseTo((20015 / (28 * 1000)) * 100, 3);
    expect(plan.maxPalayPrice).toBeCloseTo((28 * 650 + 985 - 1000) / 1000, 3);
    // At that recovery the lot exactly breaks even.
    const atNeeded = pricePlan({
      ...lot,
      recoveryPct: plan.recoveryNeededPct!,
      marketPrice: null,
    })!;
    expect(profitAt(atNeeded, 28)).toBeCloseTo(0, 3);
  });

  it("weighs wet palay down to 14% for the rice, but pays for it as bought", () => {
    const plan = pricePlan({ ...lot, moisturePct: 22, otherCosts: 0, byproducts: [] })!;
    expect(plan.standardKg).toBeCloseTo((1000 * 78) / 86);
    expect(plan.totalCost).toBe(20000);
    expect(plan.riceKg).toBeCloseTo(((1000 * 78) / 86) * 0.65);
  });

  it("leaves drier palay as weighed", () => {
    expect(pricePlan({ ...lot, moisturePct: 12 })!.standardKg).toBe(1000);
  });

  it("counts the by-products weighed in kilos as income", () => {
    expect(pricePlan({ ...lot, extraIncome: 100 })!.byproductIncome).toBeCloseTo(1085);
  });

  it("gives nothing until there's rice to price and a cost to cover", () => {
    expect(pricePlan({ ...lot, recoveryPct: 0 })).toBeNull();
    expect(pricePlan({ ...lot, palayKg: 0, otherCosts: 0 })).toBeNull();
  });
});

describe("estimateByproducts", () => {
  it("estimates the by-products a recovery should leave", () => {
    const e = estimateByproducts(65);
    expect(e.ipa).toBe(20);
    expect(e.darak).toBe(10);
    expect(e.binlid).toBeCloseTo((2.5 * 2) / 3);
    expect(e.mata).toBeCloseTo(2.5 / 3);
  });

  it("leaves less bran and no brokens at a high recovery", () => {
    expect(estimateByproducts(70)).toEqual({ ipa: 20, darak: 7.5, binlid: 0, mata: 0 });
    expect(estimateByproducts(85).darak).toBe(0);
  });

  it("caps the binlid and the mata-mata at a low recovery", () => {
    const e = estimateByproducts(50);
    expect(e.darak).toBe(10);
    expect(e.binlid).toBe(3);
    expect(e.mata).toBe(1.5);
  });
});

describe("what a price earns", () => {
  it("is a loss below break-even and the plan's profit at the recommended price", () => {
    const plan = pricePlan(lot)!;
    expect(profitAt(plan, 34.5)).toBeCloseTo(plan.profit);
    expect(profitAt(plan, 30)).toBeLessThan(0);
  });

  it("compares the recommended price with ₱1 and ₱2 either side", () => {
    expect(priceSteps(pricePlan(lot)!)).toEqual([32.5, 33.5, 34.5, 35.5, 36.5]);
  });
});
