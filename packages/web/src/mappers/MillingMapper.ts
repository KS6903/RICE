// MillingMapper — derives the per-batch table summary (total input, milled
// output, recovery %) from a milling batch row. Extracted from MillingPage's
// inline row computation (Phase F) so it's unit-testable.

export type BatchSummary = {
  totalInput: number;
  milledKg: number | null;
  /** Milled output as a % of total input, or null when not computable. */
  recovery: number | null;
};

export class MillingMapper {
  static summarizeBatch(batch: {
    inputs?: { input_weight_kg: number | string }[];
    outputs?: { output_type: string; output_weight_kg: number | string }[];
  }): BatchSummary {
    const totalInput = batch.inputs?.reduce((s, i) => s + Number(i.input_weight_kg), 0) || 0;
    const milledOutput = batch.outputs?.find((o) => o.output_type === "milled_rice");
    const milledKg = milledOutput ? Number(milledOutput.output_weight_kg) : null;
    const recovery = milledKg != null && totalInput > 0 ? (milledKg / totalInput) * 100 : null;
    return { totalInput, milledKg, recovery };
  }
}

// ── Output estimate ────────────────────────────────────────────────────────────
// What a batch should give back, worked out from the palay going in:
//  1. Palay wetter than 14% is weighed down to 14% (the milling standard) by
//     the dry-matter ratio: kg × (100 − moisture) ÷ (100 − 14). Drier palay is
//     left as weighed: it doesn't give more rice, only more broken grains.
//  2. Milled rice (bigas) = that weight × the variety's milling recovery, or
//     65% when the variety has none (Philippine mills run about 55–72%).
//  3. Hull (ipa) is about 20% of palay, so brown rice is the other 80%; bran
//     (darak) is about 10%, less when a high recovery leaves under 10% of the
//     brown rice to polish off.
//  4. What's left is moisture driven off, dust and spillage.

export const STANDARD_MOISTURE_PCT = 14;
export const DEFAULT_RECOVERY_PCT = 65;
export const HULL_PCT = 20;
export const BRAN_PCT = 10;

export type EstimateInput = {
  variety_id?: string;
  input_weight_kg: number | string;
  moisture_content_pct?: number | string | null;
};

export type OutputEstimate = {
  palayKg: number;
  /** Palay weight at 14% moisture. */
  adjustedKg: number;
  milled_rice: number;
  ipa: number;
  darak: number;
  lossKg: number;
  /** Milled rice as a % of the palay as weighed. */
  recoveryPct: number | null;
};

const kg = (n: number) => Math.round(n * 10) / 10;

export function estimateOutputs(
  inputs: EstimateInput[],
  /** typical_recovery_pct per variety id. */
  recoveryByVariety: Record<string, number | null | undefined> = {},
): OutputEstimate {
  let palayKg = 0;
  let adjustedKg = 0;
  let milled = 0;
  let bran = 0;
  for (const inp of inputs) {
    const w = Number(inp.input_weight_kg);
    if (!Number.isFinite(w) || w <= 0) continue;
    const mc = Number(inp.moisture_content_pct);
    const atStandard =
      mc > STANDARD_MOISTURE_PCT && mc < 100 ? (w * (100 - mc)) / (100 - STANDARD_MOISTURE_PCT) : w;
    const typical = Number(recoveryByVariety[inp.variety_id ?? ""]);
    const recovery = Math.min(100 - HULL_PCT, typical > 0 ? typical : DEFAULT_RECOVERY_PCT);
    palayKg += w;
    adjustedKg += atStandard;
    milled += (atStandard * recovery) / 100;
    bran += (atStandard * Math.min(BRAN_PCT, 100 - HULL_PCT - recovery)) / 100;
  }
  const hull = (adjustedKg * HULL_PCT) / 100;
  return {
    palayKg: kg(palayKg),
    adjustedKg: kg(adjustedKg),
    milled_rice: kg(milled),
    ipa: kg(hull),
    darak: kg(bran),
    lossKg: kg(palayKg - milled - hull - bran),
    recoveryPct: palayKg > 0 ? (milled / palayKg) * 100 : null,
  };
}
