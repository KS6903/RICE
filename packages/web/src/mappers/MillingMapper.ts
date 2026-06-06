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
