import { describe, it, expect } from "vitest";
import { MillingService } from "./MillingService";

describe("MillingService.toBatchPayload", () => {
  it("parses numeric input/output fields and nulls empties", () => {
    const form = {
      equipment_id: "",
      customer_id: "",
      client_arrangement: "contracted" as const,
      client_notes: "ignored without a client",
      start_datetime: "2026-06-06T08:00",
      remarks: "",
      inputs: [
        { variety_id: "v1", grade_id: "", input_weight_kg: "500", moisture_content_pct: "14" },
      ],
      outputs: [
        {
          output_type: "milled_rice",
          variety_id: "",
          output_weight_kg: "300",
          weight_manual: true,
          broken_rice_pct: "",
          grade_name: "regular",
        },
      ],
    };
    const payload = MillingService.toBatchPayload(form);
    expect(payload.equipment_id).toBeNull();
    expect(payload.customer_id).toBeNull();
    expect(payload.client_arrangement).toBeNull();
    expect(payload.client_notes).toBeNull();
    expect(payload.inputs[0]).toMatchObject({
      variety_id: "v1",
      grade_id: null,
      input_weight_kg: 500,
      moisture_content_pct: 14,
      purchase_item_id: null,
    });
    expect(payload.outputs[0]).toMatchObject({
      output_type: "milled_rice",
      variety_id: null,
      output_weight_kg: 300,
      broken_rice_pct: null,
    });
    expect(payload.outputs[0]).not.toHaveProperty("weight_manual");
  });

  it("sends a client batch's terms, trimmed", () => {
    const payload = MillingService.toBatchPayload({
      equipment_id: "",
      customer_id: "c1",
      client_arrangement: "mill_keeps_byproducts",
      client_notes: "  ₱150 per cavan  ",
      start_datetime: "2026-06-06T08:00",
      remarks: "",
      inputs: [],
      outputs: [],
    });
    expect(payload).toMatchObject({
      customer_id: "c1",
      client_arrangement: "mill_keeps_byproducts",
      client_notes: "₱150 per cavan",
    });
  });
});
