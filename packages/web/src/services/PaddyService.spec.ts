import { describe, it, expect } from "vitest";
import { PaddyService, blankPurchaseItem, pricePerCavan } from "./PaddyService";

describe("PaddyService.toPurchasePayload", () => {
  it("parses numeric fields and nulls out empty ids/optionals", () => {
    const form = {
      purchase_date: "2026-06-06",
      delivery_type: "delivered",
      remarks: "",
      items: [
        {
          ...blankPurchaseItem(),
          variety_id: "v1",
          gross_weight_kg: "1000",
          tare_weight_kg: "50",
          moisture_content_pct: "14",
          price_per_kg: "24",
        },
        {
          ...blankPurchaseItem(),
          gross_weight_kg: "500",
          tare_weight_kg: "",
          price_per_kg: "20",
        },
      ],
    };
    const payload = PaddyService.toPurchasePayload(form);
    expect(payload.items[0]).toEqual({
      variety_id: "v1",
      grade_id: null,
      sack_count: null,
      cavan_count: null,
      gross_weight_kg: 1000,
      tare_weight_kg: 50,
      moisture_content_pct: 14,
      price_per_cavan: 1200,
      is_wet: false,
      dried_weight_kg: null,
      dried_moisture_pct: null,
    });
    expect(payload.items[1]).toEqual({
      variety_id: null,
      grade_id: null,
      sack_count: null,
      cavan_count: null,
      gross_weight_kg: 500,
      tare_weight_kg: 0,
      moisture_content_pct: null,
      price_per_cavan: 1000,
      is_wet: false,
      dried_weight_kg: null,
      dried_moisture_pct: null,
    });
  });

  it("counts in sacks: cavans and kilos left blank are sent as nothing", () => {
    const payload = PaddyService.toPurchasePayload({
      purchase_date: "2026-10-29",
      delivery_type: "delivered",
      remarks: "",
      items: [{ ...blankPurchaseItem(), sack_count: "20", price_per_kg: "24" }],
    });
    expect(payload.items[0]).toMatchObject({
      sack_count: 20,
      cavan_count: null,
      gross_weight_kg: null,
    });
  });

  it("sends the after-drying figures only for wet palay", () => {
    const line = {
      ...blankPurchaseItem(),
      sack_count: "20",
      price_per_kg: "24",
      dried_weight_kg: "800",
      dried_moisture_pct: "14",
    };
    const [wet, dry] = PaddyService.toPurchasePayload({
      purchase_date: "2026-10-29",
      delivery_type: "delivered",
      remarks: "",
      items: [
        { ...line, is_wet: true },
        { ...line, is_wet: false },
      ],
    }).items;
    expect(wet).toMatchObject({ is_wet: true, dried_weight_kg: 800, dried_moisture_pct: 14 });
    expect(dry).toMatchObject({ is_wet: false, dried_weight_kg: null, dried_moisture_pct: null });
  });
});

describe("pricePerCavan", () => {
  it("is the price per kilo times the 50 kg of a cavan, to the centavo", () => {
    expect(pricePerCavan("24")).toBe(1200);
    expect(pricePerCavan("24.5")).toBe(1225);
    expect(pricePerCavan("23.1")).toBe(1155); // not 1155.0000000000002
    expect(pricePerCavan("22.333")).toBe(1116.65);
  });

  it("is nothing until a price is typed", () => {
    expect(pricePerCavan("")).toBeNull();
  });
});

describe("PaddyService (DI-mocked http)", () => {
  it("listSuppliers passes include_inactive through", async () => {
    const calls: string[] = [];
    const fakeHttp = {
      get: (url: string) => {
        calls.push(url);
        return Promise.resolve({ data: [] });
      },
    } as any;
    const svc = new PaddyService(fakeHttp);
    await svc.listSuppliers(true);
    await svc.listSuppliers(false);
    expect(calls).toEqual([
      "/paddy/suppliers?include_inactive=true",
      "/paddy/suppliers?include_inactive=false",
    ]);
  });

  it("passes the chosen warehouse through", () => {
    const payload = PaddyService.toPurchasePayload({
      branch_id: "b2",
      purchase_date: "2026-10-17",
      delivery_type: "delivered",
      remarks: "",
      items: [],
    });
    expect(payload.branch_id).toBe("b2");
  });
});
