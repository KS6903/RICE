import { describe, it, expect } from "vitest";
import { PaddyService } from "./PaddyService";

describe("PaddyService.toPurchasePayload", () => {
  it("parses numeric fields and nulls out empty ids/optionals", () => {
    const form = {
      purchase_date: "2026-06-06",
      delivery_type: "delivered",
      remarks: "",
      items: [
        {
          variety_id: "v1",
          grade_id: "",
          gross_weight_kg: "1000",
          tare_weight_kg: "50",
          moisture_content_pct: "14",
          price_per_cavan: "1200",
        },
        {
          variety_id: "",
          grade_id: "",
          gross_weight_kg: "500",
          tare_weight_kg: "",
          moisture_content_pct: "",
          price_per_cavan: "1000",
        },
      ],
    };
    const payload = PaddyService.toPurchasePayload(form);
    expect(payload.items[0]).toEqual({
      variety_id: "v1",
      grade_id: null,
      gross_weight_kg: 1000,
      tare_weight_kg: 50,
      moisture_content_pct: 14,
      price_per_cavan: 1200,
    });
    expect(payload.items[1]).toEqual({
      variety_id: null,
      grade_id: null,
      gross_weight_kg: 500,
      tare_weight_kg: 0,
      moisture_content_pct: null,
      price_per_cavan: 1000,
    });
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
});
