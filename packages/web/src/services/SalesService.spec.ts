import { describe, it, expect } from "vitest";
import { SalesService } from "./SalesService";

describe("SalesService.toCustomerPayload", () => {
  it("parses credit limit and payment terms", () => {
    const out = SalesService.toCustomerPayload({
      name: "ACME", credit_limit: "5000.5", payment_terms_days: "30",
    });
    expect(out).toMatchObject({ name: "ACME", credit_limit: 5000.5, payment_terms_days: 30 });
  });
  it("defaults blank numbers to 0", () => {
    const out = SalesService.toCustomerPayload({ name: "X", credit_limit: "", payment_terms_days: "" });
    expect(out.credit_limit).toBe(0);
    expect(out.payment_terms_days).toBe(0);
  });
});

describe("SalesService.toOrderPayload", () => {
  it("parses discount + line-item numbers and nulls empty variety", () => {
    const out = SalesService.toOrderPayload({
      customer_id: "c1", discount_pct: "10",
      items: [{ item_type: "milled_rice", variety_id: "", quantity_kg: "100", unit_price_per_kg: "50" }],
    });
    expect(out.discount_pct).toBe(10);
    expect(out.items[0]).toMatchObject({ variety_id: null, quantity_kg: 100, unit_price_per_kg: 50 });
  });
});
