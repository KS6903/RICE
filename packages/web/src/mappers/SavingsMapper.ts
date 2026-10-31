// SavingsMapper — the sums the screen needs while someone types or reads a batch, the
// same as the server's savings_formulas.py. Both are tested with the same worked
// examples.
//
//  Payable weight = net × (1 − impurity) × (100 − moisture) ÷ 86, the moisture part
//                   only above 14%.
//  Blend          = share of the broken stream
//                 = (target − head's broken %) ÷ (stream's broken % − head's broken %).
//  Unaccounted    = palay in − everything out; only meaningful once by-products are in.
export const BENCHMARK_MRR_PCT = 63;
export const BENCHMARK_BROKEN_PCT = 8;
export const BENCHMARK_UNACCOUNTED_PCT = 2;

export function payableWeight(
  netKg: number,
  moisturePct: number | null,
  impurityPct: number | null,
): number | null {
  const wet = moisturePct != null && moisturePct > 14 && moisturePct < 100;
  const dirty = impurityPct != null && impurityPct > 0 && impurityPct < 100;
  if (!wet && !dirty) return null;
  let kg = netKg;
  if (dirty) kg = (kg * (100 - impurityPct)) / 100;
  if (wet) kg = (kg * (100 - moisturePct)) / 86;
  return Math.round(kg * 1000) / 1000;
}

export type Blend = { streamPct: number; streamKg: number; headKg: number };

/** How much of a broken stream to add to head rice to hit a contract's broken %, or
 *  null when the two bins can't make that grade. */
export function blend(
  headBrokenPct: number,
  streamBrokenPct: number,
  targetPct: number,
  totalKg: number,
): Blend | null {
  const low = Math.min(headBrokenPct, streamBrokenPct);
  const high = Math.max(headBrokenPct, streamBrokenPct);
  if (headBrokenPct === streamBrokenPct || targetPct < low || targetPct > high) return null;
  const share = (targetPct - headBrokenPct) / (streamBrokenPct - headBrokenPct);
  return { streamPct: share * 100, streamKg: totalKg * share, headKg: totalKg * (1 - share) };
}

type BatchLike = {
  inputs?: { input_weight_kg: number | string }[];
  outputs?: {
    output_type: string;
    output_weight_kg: number | string;
    broken_rice_pct?: number | string | null;
  }[];
};

export type BatchFlags = {
  lowRecovery: boolean;
  highBroken: boolean;
  unaccountedKg: number | null;
  unaccountedPct: number | null;
  overUnaccounted: boolean;
};

/** A batch against the benchmarks, for the Milling page on every plan. */
export function batchFlags(batch: BatchLike): BatchFlags {
  const inputKg = (batch.inputs ?? []).reduce((s, i) => s + Number(i.input_weight_kg), 0);
  const outputs = batch.outputs ?? [];
  const outKg = outputs.reduce((s, o) => s + Number(o.output_weight_kg), 0);
  const rice = outputs.filter((o) => o.output_type === "milled_rice");
  const milledKg = rice.reduce((s, o) => s + Number(o.output_weight_kg), 0);
  const graded = rice.filter((o) => o.broken_rice_pct != null);
  const gradedKg = graded.reduce((s, o) => s + Number(o.output_weight_kg), 0);
  const brokenPct =
    gradedKg > 0
      ? graded.reduce((s, o) => s + Number(o.output_weight_kg) * Number(o.broken_rice_pct), 0) /
        gradedKg
      : null;
  const complete = outputs.some((o) => o.output_type !== "milled_rice");
  const unaccountedKg = complete && inputKg > 0 ? inputKg - outKg : null;
  const unaccountedPct = unaccountedKg != null ? (unaccountedKg / inputKg) * 100 : null;
  return {
    lowRecovery: milledKg > 0 && inputKg > 0 && (milledKg / inputKg) * 100 < BENCHMARK_MRR_PCT,
    highBroken: brokenPct != null && brokenPct > BENCHMARK_BROKEN_PCT,
    unaccountedKg,
    unaccountedPct,
    overUnaccounted: unaccountedPct != null && Math.abs(unaccountedPct) > BENCHMARK_UNACCOUNTED_PCT,
  };
}
