import { describe, it, expect } from "vitest";
import { BuyingService } from "./BuyingService";

const header = { purchase_date: "2026-10-17", delivery_type: "delivered", remarks: "" };

describe("BuyingService payloads", () => {
  it("turns a rice line into numbers, 50 kg sacks unless told otherwise", () => {
    const payload = BuyingService.toRicePayload({
      ...header,
      branch_id: "b2",
      items: [
        {
          variety_id: "v1",
          grade_name: "premium",
          sack_count: "20",
          kg_per_sack: "",
          price_per_sack: "2,400",
        },
        {
          variety_id: "",
          grade_name: "",
          sack_count: "4",
          kg_per_sack: "25",
          price_per_sack: "1250",
        },
      ],
    });
    expect(payload.branch_id).toBe("b2");
    expect(payload.items).toEqual([
      {
        variety_id: "v1",
        grade_name: "premium",
        sack_count: 20,
        kg_per_sack: 50,
        price_per_sack: 2400,
      },
      { variety_id: null, grade_name: null, sack_count: 4, kg_per_sack: 25, price_per_sack: 1250 },
    ]);
  });

  it("turns a by-product line into numbers", () => {
    const payload = BuyingService.toByproductPayload({
      ...header,
      items: [{ byproduct_type: "darak", weight_kg: "500", price_per_kg: "14.5" }],
    });
    expect(payload.items).toEqual([
      { byproduct_type: "darak", weight_kg: 500, price_per_kg: 14.5 },
    ]);
  });
});
