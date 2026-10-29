import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { User } from "@rice-mill/shared";
import PurchaseColumn from "./PurchaseColumn";
import SaleColumn from "./SaleColumn";
import PaddyPage from "../../pages/PaddyPage";
import { useAuthStore } from "../../stores/authStore";
import { salesService } from "../../services/SalesService";
import { paddyService } from "../../services/PaddyService";
import { inventoryService } from "../../services/InventoryService";
import { byproductKindService } from "../../services/ByproductKindService";
import { chooseOption } from "../../test/pickers";

configure({ asyncUtilTimeout: 5000 });

const owner: User = {
  id: "u1",
  username: "mill1",
  full_name: "Mill Owner",
  role: "owner",
  company_id: "c1",
  branch_id: "b1",
  features: ["paddy", "sales"],
};

const draw = (ui: React.ReactNode) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );

const ricePurchase = {
  id: "p1",
  reference_no: "RP-20261017-0001",
  purchase_date: "2026-10-17",
  supplier: { name: "Bulacan Rice Trading" },
  branch: { name: "Main Branch" },
  branch_id: "b1",
  status: "received",
  delivery_type: "picked_up",
  item_count: 1,
  total_kg: 1000,
  total_amount: 48000,
  created_by_name: "Mill Owner",
  created_by_role: "owner",
  items: [
    {
      id: "l1",
      variety_code: "RC222",
      grade_name: "premium",
      sack_count: 20,
      kg_per_sack: 50,
      weight_kg: 1000,
      price_per_sack: 2400,
      line_total: 48000,
    },
  ],
};

const mixedOrder = {
  id: "o1",
  order_no: "TM-12",
  order_date: "2026-10-16",
  status: "invoiced",
  discount_pct: 0,
  total_amount: 25400,
  customer: { name: "Aling Nena Store", address: "Cabanatuan City" },
  invoice: {
    invoice_no: "INV-20261016-0003",
    status: "partial",
    paid_amount: 10000,
    total_amount: 25400,
  },
  items: [
    {
      id: "i1",
      item_type: "palay",
      variety_code: "RC222",
      grade_name: "A",
      quantity_kg: 1000,
      unit_price_per_kg: 22,
      line_total: 22000,
    },
    {
      id: "i2",
      item_type: "milled_rice",
      variety_code: "RC222",
      grade_name: "premium",
      quantity_kg: 50,
      unit_price_per_kg: 68,
      line_total: 3400,
    },
  ],
};

afterEach(() => {
  vi.restoreAllMocks();
  useAuthStore.setState({ user: null });
});

describe("Purchases column", () => {
  it("opens a purchase's lines and totals in a popup", () => {
    draw(
      <PurchaseColumn
        kind="rice"
        purchases={[ricePurchase]}
        canBuy
        onNew={() => {}}
        empty={null}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Bulacan Rice Trading/ }));

    const popup = screen.getByTestId("purchase-details");
    expect(within(popup).getByText("Purchase RP-20261017-0001")).toBeInTheDocument();
    expect(within(popup).getByText("Picked up")).toBeInTheDocument();
    expect(within(popup).getByText("Premium")).toBeInTheDocument();
    expect(within(popup).getAllByText("₱48,000.00").length).toBeGreaterThan(0);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("purchase-details")).toBeNull();
  });
});

describe("Sales column", () => {
  beforeEach(() => {
    vi.spyOn(salesService, "listCustomers").mockResolvedValue([
      { id: "c1", name: "Aling Nena Store" },
    ]);
    vi.spyOn(paddyService, "listVarieties").mockResolvedValue([
      { id: "v1", code: "RC222", kind: "both" },
    ]);
    vi.spyOn(paddyService, "listGrades").mockResolvedValue([{ id: "g1", code: "A" }]);
    vi.spyOn(byproductKindService, "list").mockResolvedValue([]);
  });

  it("lists the orders that sell this page's goods, counting only those lines", async () => {
    const list = vi.spyOn(salesService, "listOrders").mockResolvedValue([mixedOrder]);
    useAuthStore.setState({ user: owner });
    draw(<SaleColumn kind="palay" />);

    const column = screen.getByTestId("sales-column");
    const row = await within(column).findByRole("button", { name: /Aling Nena Store/ });
    expect(list).toHaveBeenCalledWith("palay");
    // 1,000 kg of palay, not the 50 kg of rice on the same order.
    expect(within(row).getByText("1,000 kg")).toBeInTheDocument();
    expect(within(row).getByText("₱22,000.00")).toBeInTheDocument();

    fireEvent.click(row);
    const popup = screen.getByTestId("sale-details");
    expect(within(popup).getByText("Sale TM-12")).toBeInTheDocument();
    expect(within(popup).getByText("INV-20261016-0003 (partial)")).toBeInTheDocument();
    expect(within(popup).getByText("₱10,000.00 of ₱25,400.00")).toBeInTheDocument();
    expect(within(popup).getByText(/also has 1 other line/)).toBeInTheDocument();
    expect(within(popup).getByRole("link", { name: "Open in Sales" })).toHaveAttribute(
      "href",
      "/sales",
    );
  });

  it("records a palay sale as a sales order of palay lines", async () => {
    vi.spyOn(salesService, "listOrders").mockResolvedValue([]);
    const create = vi.spyOn(salesService, "createOrder").mockResolvedValue({ id: "o2" });
    useAuthStore.setState({ user: owner });
    draw(<SaleColumn kind="palay" />);

    fireEvent.click(await screen.findByRole("button", { name: /New Sale/ }));
    const popup = screen.getByTestId("new-sale");
    const save = within(popup).getByRole("button", { name: "Save Sale" });
    expect(save).toBeDisabled(); // no customer yet

    await chooseOption("Customer", "Aling Nena Store");
    await chooseOption("Variety", "RC222");
    await chooseOption("Grade", "A");
    fireEvent.change(within(popup).getByPlaceholderText("kg"), { target: { value: "1000" } });
    fireEvent.change(within(popup).getByPlaceholderText("₱/kg"), { target: { value: "22" } });
    expect(screen.getByTestId("sale-total")).toHaveTextContent("₱22,000.00");

    fireEvent.click(save);
    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0][0]).toMatchObject({
      customer_id: "c1",
      items: [
        {
          item_type: "palay",
          variety_id: "v1",
          grade_name: "A",
          byproduct_type: null,
          quantity_kg: "1000",
          unit_price_per_kg: "22",
        },
      ],
    });
  });

  it("says why there's nothing to see when the plan or the role leaves sales out", () => {
    const list = vi.spyOn(salesService, "listOrders").mockResolvedValue([]);
    useAuthStore.setState({ user: { ...owner, features: ["paddy"] } });
    const { unmount } = draw(<SaleColumn kind="rice" />);
    expect(screen.getByText(/part of the Sales feature/)).toBeInTheDocument();
    unmount();

    useAuthStore.setState({ user: { ...owner, role: "mill_operator" } });
    draw(<SaleColumn kind="rice" />);
    expect(screen.getByText(/Your role doesn't see sales/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /New Sale/ })).toBeNull();
    expect(list).not.toHaveBeenCalled();
  });
});

describe("Paddy / Palay page layout", () => {
  it("puts purchases on the left and sales on the right, with the purchase form in a popup", async () => {
    vi.spyOn(paddyService, "listPurchases").mockResolvedValue([]);
    vi.spyOn(paddyService, "listVarieties").mockResolvedValue([]);
    vi.spyOn(paddyService, "listGrades").mockResolvedValue([]);
    vi.spyOn(paddyService, "listInventory").mockResolvedValue([]);
    vi.spyOn(inventoryService, "getBranches").mockResolvedValue([]);
    vi.spyOn(salesService, "listOrders").mockResolvedValue([]);
    useAuthStore.setState({ user: owner });
    draw(<PaddyPage />);

    const columns = [screen.getByTestId("purchases-column"), screen.getByTestId("sales-column")];
    expect(
      columns[0].compareDocumentPosition(columns[1]) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(await within(columns[1]).findByText("No palay sold yet")).toBeInTheDocument();

    fireEvent.click(within(columns[0]).getByRole("button", { name: /New Purchase/ }));
    expect(screen.getByRole("dialog", { name: "New Palay Purchase" })).toBeInTheDocument();
  });
});

describe("Purchases and sales while they load", () => {
  it("says the purchases are loading, not that nothing was bought", () => {
    draw(
      <PurchaseColumn
        kind="palay"
        purchases={[]}
        loading
        canBuy={false}
        onNew={() => {}}
        empty={<p>No palay bought yet</p>}
      />,
    );
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(screen.queryByText("No palay bought yet")).toBeNull();
    expect(screen.queryByText(/0 bought/)).toBeNull();
  });

  it("says the sales are loading until the orders arrive", () => {
    vi.spyOn(salesService, "listOrders").mockReturnValue(new Promise(() => {}));
    useAuthStore.setState({ user: owner });
    draw(<SaleColumn kind="palay" />);
    const column = screen.getByTestId("sales-column");
    expect(within(column).getByText("Loading…")).toBeInTheDocument();
    expect(within(column).queryByText("No palay sold yet")).toBeNull();
  });
});
