import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configure, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { User } from "@rice-mill/shared";
import SalesPage from "../../pages/SalesPage";
import { useAuthStore } from "../../stores/authStore";
import { salesService } from "../../services/SalesService";
import { inventoryService } from "../../services/InventoryService";

configure({ asyncUtilTimeout: 5000 });

const boss: User = {
  id: "u1",
  username: "mill1",
  full_name: "Mill Boss",
  role: "owner",
  company_id: "c1",
};

const order = {
  id: "o1",
  order_no: "RM1-0001",
  order_date: "2026-10-20",
  delivery_date: null,
  customer_id: "c1",
  customer: { id: "c1", name: "Aling Nena Store" },
  discount_pct: "0",
  remarks: null,
  total_amount: "5000",
  status: "invoiced",
  items: [
    {
      item_type: "milled_rice",
      variety_id: "v1",
      variety_code: "RC160",
      grade_name: "regular",
      byproduct_type: null,
      quantity_kg: "100",
      unit_price_per_kg: "50",
    },
  ],
};

const draw = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <SalesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe("Sales: correcting saved records", () => {
  beforeEach(() => {
    vi.spyOn(salesService, "listOrders").mockResolvedValue([order]);
    vi.spyOn(salesService, "listInvoices").mockResolvedValue([]);
    vi.spyOn(salesService, "listCustomers").mockResolvedValue([
      { id: "c1", name: "Aling Nena Store", is_active: true },
    ]);
    vi.spyOn(inventoryService, "getMilledRice").mockResolvedValue([]);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    useAuthStore.setState({ user: null });
  });

  it("the Boss corrects an order's kilos, and the whole order goes to the API", async () => {
    useAuthStore.setState({ user: boss });
    const edit = vi.spyOn(salesService, "editOrder").mockResolvedValue(order);
    draw();
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit order RM1-0001" });
    const kilos = within(dialog).getByRole("spinbutton", { name: "Kilos of RC160 regular" });
    fireEvent.change(kilos, { target: { value: "120" } });
    expect(dialog).toHaveTextContent("New total: ₱6,000");
    fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));

    await vi.waitFor(() => expect(edit).toHaveBeenCalled());
    const [id, body] = edit.mock.calls[0];
    expect(id).toBe("o1");
    expect(body.items?.[0]).toMatchObject({ quantity_kg: 120, unit_price_per_kg: 50 });
    expect(body.customer_id).toBe("c1");
  });

  it("history lists each change, field by field", async () => {
    useAuthStore.setState({ user: boss });
    vi.spyOn(salesService, "history").mockResolvedValue([
      {
        id: "a1",
        action: "sales_order.edit",
        user_name: "Mill Boss",
        detail:
          "Items: RC160 regular 100 kg at ₱50 → RC160 regular 120 kg at ₱50\nTotal (₱): 5,000 → 6,000",
        created_at: "2026-10-24T03:00:00Z",
      },
    ]);
    draw();
    fireEvent.click(await screen.findByRole("button", { name: "History" }));
    const dialog = await screen.findByRole("dialog", { name: "History of RM1-0001" });
    expect(await within(dialog).findByText("Total (₱): 5,000 → 6,000")).toBeInTheDocument();
    expect(dialog).toHaveTextContent("Mill Boss");
  });

  it("staff see the history but can't correct a saved order", async () => {
    useAuthStore.setState({ user: { ...boss, role: "cashier" } });
    draw();
    expect(await screen.findByRole("button", { name: "History" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });
});
