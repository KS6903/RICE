// RecoveryMapper — the milling-recovery formulas behind the recovery calculator
// on a palay purchase. A small sample of the palay is milled and every part of
// what comes out is weighed; all the percentages follow from those weights.
//
//  Milling recovery  = milled rice ÷ palay × 100. The milled rice counts its
//                      brokens (PNS/BAFS PABES 304, the Philippine rice-mill
//                      test; PhilRice, IRRI).
//  Head rice         = whole kernels, at least ¾ of their length. It is given as
//                      a % of the palay (head rice recovery) and of the milled
//                      rice (PNS/BAFS), and the rest of the milled rice is the
//                      broken: 100 − head rice % of the milled rice.
//  Husk and bran     = each ÷ palay × 100 (IRRI: about 20% husk, 8–10% bran).
//  Not accounted for = what's left of the palay after the milled rice, husk and
//                      bran: moisture driven off, dust and spillage. Only
//                      worked out when both husk and bran were weighed.
//  At 14% moisture   = the palay is weighed down to 14%, the milling standard,
//                      by the dry-matter ratio kg × (100 − moisture) ÷ (100 − 14)
//                      (IRRI); as on the Milling page, only palay wetter than
//                      14% is changed, since wet palay under-reads the recovery.
import { DEFAULT_RECOVERY_PCT, STANDARD_MOISTURE_PCT } from "./MillingMapper";

/** A cavan of palay is 50 kg, as on the server. */
const KG_PER_CAVAN = 50;

export type RecoveryInput = {
  sampleKg: number | null;
  moisturePct: number | null;
  milledKg: number | null;
  headKg: number | null;
  huskKg: number | null;
  branKg: number | null;
};

export type RecoveryResult = {
  /** Milled rice (brokens included) as a % of the palay. */
  recoveryPct: number;
  headOfPalayPct: number | null;
  headOfMilledPct: number | null;
  brokenOfMilledPct: number | null;
  huskPct: number | null;
  branPct: number | null;
  /** Negative when the parts weigh more than the sample. */
  notAccountedPct: number | null;
  /** The recovery with the palay weighed at 14% moisture; null unless it was wetter. */
  recoveryAt14Pct: number | null;
  /** Kilos of milled rice from one 50 kg cavan of palay. */
  riceKgPerCavan: number;
};

/** What stops a test from being saved: the weights can't be true. */
export type RecoveryProblem = "rice-over-palay" | "head-over-rice" | "part-over-palay";

/** A typed weight or percent, or null while it's blank, negative or not a number. */
export const parseAmount = (v: string): number | null => {
  if (v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/** What the calculator's weights are typed in: a sample is often weighed in grams. */
export type WeightUnit = "kg" | "g";
export const WEIGHT_UNITS: WeightUnit[] = ["kg", "g"];
const G_PER_KG = 1000;

/** Kilos in an amount weighed in `unit`, to the milligram: what the server keeps. */
export const toKg = (amount: number, unit: WeightUnit): number => {
  const kg = unit === "g" ? amount / G_PER_KG : amount;
  return Math.round(kg * 1e6) / 1e6;
};

/** A typed amount shown again in another unit, the weight unchanged ("100" kg is
 *  "100000" g). A blank or unreadable amount is left as it is. */
export const convertAmount = (text: string, from: WeightUnit, to: WeightUnit): string => {
  const n = parseAmount(text);
  if (n == null || from === to) return text;
  const converted = from === "kg" ? n * G_PER_KG : n / G_PER_KG;
  // toPrecision drops float noise: 0.1 kg is 100 g, not 100.00000000000001.
  return String(Number(converted.toPrecision(12)));
};

/** Kilos as people read them: under a kilo, in grams ("32.5 g"). */
export const formatWeight = (kg: unknown): string => {
  const n = Number(kg ?? 0);
  if (n > 0 && n < 1) return `${Number((n * G_PER_KG).toPrecision(6)).toLocaleString()} g`;
  return `${n.toLocaleString()} kg`;
};

const pct = (part: number, whole: number) => (part / whole) * 100;

export function recoveryProblem(i: RecoveryInput): RecoveryProblem | null {
  const { sampleKg: sample, milledKg: milled } = i;
  if (sample == null || sample <= 0 || milled == null || milled <= 0) return null;
  if (milled > sample) return "rice-over-palay";
  if (i.headKg != null && i.headKg > milled) return "head-over-rice";
  if ((i.huskKg != null && i.huskKg > sample) || (i.branKg != null && i.branKg > sample)) {
    return "part-over-palay";
  }
  return null;
}

/** The results for a test, or null until the sample and the milled rice are given
 *  and could be true. */
export function computeRecovery(i: RecoveryInput): RecoveryResult | null {
  const sample = i.sampleKg;
  const milled = i.milledKg;
  if (sample == null || sample <= 0 || milled == null || milled <= 0) return null;
  if (recoveryProblem(i) !== null) return null;

  const recoveryPct = pct(milled, sample);
  const { headKg: head, huskKg: husk, branKg: bran, moisturePct: moisture } = i;
  const atStandardKg =
    moisture != null && moisture > STANDARD_MOISTURE_PCT && moisture < 100
      ? (sample * (100 - moisture)) / (100 - STANDARD_MOISTURE_PCT)
      : null;
  return {
    recoveryPct,
    headOfPalayPct: head != null ? pct(head, sample) : null,
    headOfMilledPct: head != null ? pct(head, milled) : null,
    brokenOfMilledPct: head != null ? pct(milled - head, milled) : null,
    huskPct: husk != null ? pct(husk, sample) : null,
    branPct: bran != null ? pct(bran, sample) : null,
    notAccountedPct:
      husk != null && bran != null ? pct(sample - milled - husk - bran, sample) : null,
    recoveryAt14Pct: atStandardKg != null ? pct(milled, atStandardKg) : null,
    riceKgPerCavan: (recoveryPct / 100) * KG_PER_CAVAN,
  };
}

/** How far the recovery is from the usual one: the variety's own, else the
 *  mill's 65%. Positive is above. */
export function recoveryGap(recoveryPct: number, typicalPct: number | null | undefined) {
  const usual = typicalPct != null && typicalPct > 0 ? typicalPct : DEFAULT_RECOVERY_PCT;
  return { usual, points: recoveryPct - usual };
}
