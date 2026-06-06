import { describe, it, expect } from "vitest";
import { MillingService } from "./MillingService";

describe("MillingService.toBatchPayload", () => {
  it("parses numeric input/output fields and nulls empties", () => {
    const form = {
      equipment_id: "", start_datetime: "2026-06-06T08:00", remarks: "",
      inputs: [{ variety_id: "v1", grade_id: "", input_weight_kg: "500", moisture_content_pct: "14" }],
      outputs: [{ output_type: "milled_rice", variety_id: "", output_weight_kg: "300", broken_rice_pct: "", grade_name: "regular" }],
    };
    const payload = MillingService.toBatchPayload(form);
    expect(payload.equipment_id).toBeNull();
    expect(payload.inputs[0]).toMatchObject({
      variety_id: "v1", grade_id: null, input_weight_kg: 500, moisture_content_pct: 14,
    });
    expect(payload.outputs[0]).toMatchObject({
      output_type: "milled_rice", variety_id: null, output_weight_kg: 300, broken_rice_pct: null,
    });
  });
});
