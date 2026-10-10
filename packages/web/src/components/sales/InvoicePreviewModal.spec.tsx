import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import InvoicePreviewModal, { type PreviewOrder } from "./InvoicePreviewModal";

const order: PreviewOrder = {
  id: "o1",
  order_no: "SO-20261011-0001",
  order_date: "2026-10-11",
  subtotal: 5100,
  discount_pct: 10,
  discount_amount: 510,
  total_amount: 4590,
  customer: {
    name: "Golden Harvest Trading",
    address: "Cabanatuan City",
    tin: "123-456-789",
    payment_terms_days: 15,
  },
  items: [
    {
      id: "i1",
      item_type: "milled_rice",
      variety_name: "Rc222",
      grade_name: "premium",
      byproduct_type: null,
      quantity_kg: 100,
      unit_price_per_kg: 50,
      line_total: 5000,
    },
    {
      id: "i2",
      item_type: "byproduct",
      variety_name: null,
      grade_name: null,
      byproduct_type: "darak",
      quantity_kg: 20,
      unit_price_per_kg: 5,
      line_total: 100,
    },
  ],
};

const setup = (over: Partial<Parameters<typeof InvoicePreviewModal>[0]> = {}) => {
  const props = {
    order,
    onClose: vi.fn(),
    onGenerate: vi.fn(),
    pending: false,
    error: null,
    ...over,
  };
  render(<InvoicePreviewModal {...props} />);
  return props;
};

describe("InvoicePreviewModal", () => {
  it("shows the invoice as it will be issued: customer, lines and totals", () => {
    setup();
    const sheet = screen.getByTestId("invoice-preview");
    expect(sheet.textContent).toContain("Golden Harvest Trading");
    expect(sheet.textContent).toContain("Cabanatuan City");
    expect(sheet.textContent).toContain("TIN 123-456-789");
    expect(sheet.textContent).toContain("Rc222, premium");
    expect(sheet.textContent).toContain("Darak (Rice Bran)");
    expect(sheet.textContent).toContain("₱5,100.00");
    expect(sheet.textContent).toContain("-₱510.00");
    expect(sheet.textContent).toContain("₱4,590.00");
    expect(sheet.textContent).toContain("(15 days)");
    expect(sheet.textContent).toContain("Assigned when generated");
  });

  it("is due on receipt when the customer has no payment terms", () => {
    setup({ order: { ...order, customer: { ...order.customer!, payment_terms_days: 0 } } });
    expect(screen.getByTestId("invoice-preview").textContent).toContain("(on receipt)");
  });

  it("generates only when the button is pressed, not on opening", () => {
    const props = setup();
    expect(props.onGenerate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("confirm-generate-invoice"));
    expect(props.onGenerate).toHaveBeenCalledTimes(1);
  });

  it("closes on Cancel and on Escape", () => {
    const props = setup();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(props.onClose).toHaveBeenCalledTimes(2);
  });

  it("locks while generating and shows an error from the server", () => {
    const props = setup({ pending: true, error: "Order already invoiced." });
    expect(screen.getByRole("alert").textContent).toContain("Order already invoiced.");
    const button = screen.getByTestId("confirm-generate-invoice") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain("Generating");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(props.onClose).not.toHaveBeenCalled();
  });
});
