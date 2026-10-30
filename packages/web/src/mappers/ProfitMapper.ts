// ProfitMapper — the formulas behind the Profit calculator, the same as the
// server's price_plan (backend/app/services/profit_service.py), here so the Boss
// sees the result while typing. Both are tested with the same worked example.
//
//  Palay at 14%  = kg × (100 − moisture) ÷ 86 when wetter than 14%, else as
//                  weighed, as on the Milling page.
//  Rice          = palay at 14% × recovery.
//  Total cost    = kilos as bought × price + other costs: palay is paid for at
//                  the weight it was bought, wet or not.
//  Break-even    = (total cost − by-product income) ÷ rice.
//  Target price  = break-even ÷ (1 − target margin), rounded up to ₱0.50.
//  Recommended   = what the market pays when that's above break-even, else the
//                  target price. At or below break-even it's a losing game.
//  By-products   = estimated from the recovery, until the real ones are typed:
//                  see estimateByproducts.
import { BRAN_PCT, HULL_PCT, STANDARD_MOISTURE_PCT } from "./MillingMapper";

export type ProfitInput = {
  palayKg: number;
  palayPrice: number;
  moisturePct: number | null;
  recoveryPct: number;
  otherCosts: number;
  /** Each by-product: % of the palay, ₱ per kg. */
  byproducts: { pct: number; price: number }[];
  /** What the by-products counted in kilos bring in, not as a share of the palay. */
  extraIncome?: number;
  targetMarginPct: number;
  marketPrice: number | null;
};

export type Verdict = "good" | "thin" | "losing";

export type PricePlan = {
  standardKg: number;
  riceKg: number;
  totalCost: number;
  byproductIncome: number;
  breakEven: number;
  targetPrice: number;
  recommendedPrice: number;
  marginPct: number;
  profit: number;
  verdict: Verdict;
  /** Only when losing: the loss on each kilo at the market price, the recovery that
   *  would break even there, and the most the palay could cost. */
  lossPerKg: number | null;
  recoveryNeededPct: number | null;
  maxPalayPrice: number | null;
};

/** Below this or above this, the recovery itself deserves a second look. */
export const LOW_RECOVERY_PCT = 55;
export const HIGH_RECOVERY_PCT = 72;

/** What's lost to dust and moisture, of the palay. Binlid and mata-mata are a small
 *  part of what milling leaves, never more than these. */
const LOSS_PCT = 2.5;
const MAX_BINLID_PCT = 3;
const MAX_MATA_PCT = 1.5;

export type ByproductEstimate = { ipa: number; darak: number; binlid: number; mata: number };

/** The by-products a recovery should leave, as % of the palay: an estimate only. Of
 *  100 kg, the husk is 20 and the rest is brown rice. Brown rice that doesn't come out
 *  as rice, after the loss, is bran first (about 10), then binlid and mata-mata, two
 *  parts to one. Same as the server's estimate_byproducts. */
export function estimateByproducts(recoveryPct: number): ByproductEstimate {
  const left = Math.max(100 - HULL_PCT - recoveryPct - LOSS_PCT, 0);
  const darak = Math.min(BRAN_PCT, left);
  const rest = left - darak;
  return {
    ipa: HULL_PCT,
    darak,
    binlid: Math.min(MAX_BINLID_PCT, (rest * 2) / 3),
    mata: Math.min(MAX_MATA_PCT, rest / 3),
  };
}

/** The palay's weight at 14% moisture: wetter is weighed down, drier left as is. */
export const standardWeight = (kg: number, moisturePct: number | null) =>
  moisturePct != null && moisturePct > STANDARD_MOISTURE_PCT && moisturePct < 100
    ? (kg * (100 - moisturePct)) / (100 - STANDARD_MOISTURE_PCT)
    : kg;

/** Rounded up to the next ₱0.50, never under it. The inner round stops float noise
 *  from pushing an exact ₱34.50 up to ₱35. */
const roundUpHalfPeso = (price: number) =>
  Math.max(Math.ceil(Math.round(price * 2 * 1e6) / 1e6) / 2, 0.5);

/** The selling price for a lot of palay, or null until there's rice to price and a
 *  cost to cover. */
export function pricePlan(i: ProfitInput): PricePlan | null {
  const standardKg = standardWeight(i.palayKg, i.moisturePct);
  const riceKg = (standardKg * i.recoveryPct) / 100;
  const totalCost = i.palayKg * i.palayPrice + i.otherCosts;
  if (!(riceKg > 0) || !(totalCost > 0)) return null;

  const byproductIncome = i.byproducts.reduce(
    (s, b) => s + ((standardKg * b.pct) / 100) * b.price,
    i.extraIncome ?? 0,
  );
  const breakEven = (totalCost - byproductIncome) / riceKg;
  const targetPrice = roundUpHalfPeso(breakEven / (1 - i.targetMarginPct / 100));
  const market = i.marketPrice != null && i.marketPrice > 0 ? i.marketPrice : null;
  const losing = market != null && market <= breakEven;
  const recommendedPrice = market != null && !losing ? market : targetPrice;
  const marginPct = ((recommendedPrice - breakEven) / recommendedPrice) * 100;

  return {
    standardKg,
    riceKg,
    totalCost,
    byproductIncome,
    breakEven,
    targetPrice,
    recommendedPrice,
    marginPct,
    profit: recommendedPrice * riceKg + byproductIncome - totalCost,
    verdict: losing ? "losing" : marginPct >= i.targetMarginPct ? "good" : "thin",
    lossPerKg: losing ? breakEven - market : null,
    recoveryNeededPct: losing
      ? ((totalCost - byproductIncome) / (market * standardKg)) * 100
      : null,
    maxPalayPrice: losing ? (market * riceKg + byproductIncome - i.otherCosts) / i.palayKg : null,
  };
}

/** The profit, or the loss when negative, selling all the rice at a price. */
export const profitAt = (plan: PricePlan, price: number) =>
  price * plan.riceKg + plan.byproductIncome - plan.totalCost;

/** The prices to compare: the recommended one, and ₱1 and ₱2 either side. */
export const priceSteps = (plan: PricePlan) =>
  [-2, -1, 0, 1, 2].map((d) => plan.recommendedPrice + d).filter((p) => p > 0);

/** The usual share of the palay each part comes to, with paddy at 13–14% moisture. */
export const BENCHMARKS = {
  milled: "65–70%",
  head: "48–55%",
  broken: "12–18%",
  husk: "20–22%",
  bran: "8–10%",
  loss: "2–3%",
};
