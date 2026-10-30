import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { User } from "@rice-mill/shared";
import RicePurchasesPage from "./RicePurchasesPage";
import ByproductPurchasesPage from "./ByproductPurchasesPage";
import { useAuthStore } from "../stores/authStore";
import { paddyService } from "../services/PaddyService";
import { buyingService } from "../services/BuyingService";
import { inventoryService } from "../services/InventoryService";
import { warehousesService } from "../services/WarehousesService";
import { chooseOption } from "../test/pickers";

configure({ asyncUtilTimeout: 5000 });

const owner: User = {
  id: "u1",
  username: "mill1",
  full_name: "Mill Owner",
  role: "owner",
  company_id: "c1",
  branch_id: "b1",
};
const encoder: User = { ...owner, id: "u2", username: "mill1.encoder", role: "encoder" };

const warehouseRows = [
  { id: "w1", branch_id: "b1", name: "Warehouse 1 - Main Branch", is_default: true },
  { id: "w2", branch_id: "b2", name: "Warehouse 1 - 2nd Branch", is_default: true },
];

const draw = (page: React.ReactNode) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>{page}</MemoryRouter>
    </QueryClientProvider>,
  );

beforeEach(() => {
  vi.spyOn(paddyService, "listVarieties").mockResolvedValue([{ id: "v1", code: "RC222" }]);
  vi.spyOn(inventoryService, "getBranches").mockResolvedValue([
    { id: "b1", name: "Main Branch", is_main_branch: true },
    { id: "b2", name: "2nd Branch", is_main_branch: false },
  ]);
  vi.spyOn(warehousesService, "list").mockResolvedValue(warehouseRows);
  vi.spyOn(buyingService, "listRicePurchases").mockResolvedValue([]);
  vi.spyOn(buyingService, "listRiceStock").mockResolvedValue([]);
  vi.spyOn(buyingService, "listByproductPurchases").mockResolvedValue([]);
  vi.spyOn(buyingService, "listByproductStock").mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
  useAuthStore.setState({ user: null });
});

describe("Rice (Bigas) page", () => {
  it("records sacks of rice into the branch the owner picks, showing the total", async () => {
    const create = vi.spyOn(buyingService, "createRicePurchase").mockResolvedValue({ id: "p1" });
    useAuthStore.setState({ user: owner });
    draw(<RicePurchasesPage />);
    fireEvent.click(screen.getByRole("button", { name: /New Purchase/ }));

    // No tare, no moisture: rice is bought by the sack.
    expect(screen.queryByPlaceholderText("Tare kg")).toBeNull();
    expect(screen.queryByPlaceholderText("Moisture %")).toBeNull();

    await chooseOption("Variety", "RC222");
    await chooseOption("Grade", "Graded Rice");
    await chooseOption("Branch", "2nd Branch");
    fireEvent.change(screen.getByPlaceholderText("Sacks"), { target: { value: "20" } });
    fireEvent.change(screen.getByPlaceholderText("₱/sack"), { target: { value: "2400" } });
    expect(screen.getByTestId("rice-total")).toHaveTextContent("1,000 kg");
    expect(screen.getByTestId("rice-total")).toHaveTextContent("₱48,000.00");

    fireEvent.click(screen.getByRole("button", { name: "Save Purchase" }));
    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0][0]).toMatchObject({
      branch_id: "b2",
      warehouse_id: null, // its only warehouse: nothing to ask
      delivery_type: "delivered",
      items: [{ variety_id: "v1", grade_name: "Graded Rice", sack_count: "20", kg_per_sack: "50" }],
    });
  });

  it("starts the grade on a prompt and lists the grades A to Z", async () => {
    useAuthStore.setState({ user: owner });
    draw(<RicePurchasesPage />);
    fireEvent.click(screen.getByRole("button", { name: /New Purchase/ }));

    expect(screen.getByLabelText("Grade")).toHaveTextContent("-- Select Grade --");
    expect(screen.getByLabelText("Variety")).toHaveTextContent("-- Select Variety --");
    fireEvent.click(screen.getByLabelText("Grade"));
    const options = within(screen.getByRole("listbox")).getAllByRole("option");
    expect(options.map((o) => o.textContent?.trim())).toEqual([
      "Broken Rice",
      "Graded Rice",
      "Regular-Milled Rice",
      "Straight Mill Rice",
      "Well-Milled Rice",
    ]);
  });

  it("says what is missing when saving without it, and saves nothing", async () => {
    const create = vi.spyOn(buyingService, "createRicePurchase").mockResolvedValue({ id: "p1" });
    useAuthStore.setState({ user: owner });
    draw(<RicePurchasesPage />);
    fireEvent.click(screen.getByRole("button", { name: /New Purchase/ }));

    fireEvent.click(screen.getByRole("button", { name: "Save Purchase" }));

    expect(screen.getAllByTestId("field-error").map((n) => n.textContent)).toEqual([
      "Please select an option.", // the grade
      "This field needs an input.", // the sacks
      "This field needs an input.", // the price
    ]);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Some fields still need an input. Fill in the ones marked in red.",
    );
    expect(create).not.toHaveBeenCalled();

    await chooseOption("Grade", "Graded Rice");
    fireEvent.change(screen.getByPlaceholderText("Sacks"), { target: { value: "20" } });
    fireEvent.change(screen.getByPlaceholderText("₱/sack"), { target: { value: "2400" } });
    expect(screen.queryByTestId("field-error")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save Purchase" }));
    await waitFor(() => expect(create).toHaveBeenCalled());
  });

  it("shows rice in stock, naming the branch once there are several", async () => {
    vi.mocked(buyingService.listRiceStock).mockResolvedValue([
      {
        id: "s1",
        branch_id: "b1",
        branch: { name: "Main Branch" },
        variety: { code: "RC222" },
        grade_name: "Graded Rice",
        quantity_kg: 1000,
      },
      {
        id: "s2",
        branch_id: "b2",
        branch: { name: "2nd Branch" },
        variety: { code: "RC222" },
        grade_name: "Graded Rice",
        quantity_kg: 500,
      },
    ]);
    useAuthStore.setState({ user: owner });
    draw(<RicePurchasesPage />);
    const stock = screen.getByTestId("rice-stock-index");
    expect(await within(stock).findByRole("columnheader", { name: "Branch" })).toBeInTheDocument();
    // One warehouse in each branch says nothing the branch doesn't.
    expect(within(stock).queryByRole("columnheader", { name: "Warehouse" })).toBeNull();
    expect(within(stock).getAllByText("Graded Rice")).toHaveLength(2);
  });

  it("names the warehouse too once a branch's rice sits in more than one", async () => {
    vi.mocked(buyingService.listRiceStock).mockResolvedValue([
      {
        id: "s1",
        branch_id: "b1",
        warehouse_id: "w1",
        branch: { name: "Main Branch" },
        warehouse: { name: "Warehouse 1 - Main Branch" },
        variety: { code: "RC222" },
        grade_name: "Graded Rice",
        quantity_kg: 1000,
      },
      {
        id: "s2",
        branch_id: "b1",
        warehouse_id: "w3",
        branch: { name: "Main Branch" },
        warehouse: { name: "Warehouse 2 - Main Branch" },
        variety: { code: "RC222" },
        grade_name: "Graded Rice",
        quantity_kg: 500,
      },
    ]);
    useAuthStore.setState({ user: owner });
    draw(<RicePurchasesPage />);
    const stock = screen.getByTestId("rice-stock-index");
    expect(
      await within(stock).findByRole("columnheader", { name: "Warehouse" }),
    ).toBeInTheDocument();
    expect(within(stock).getByText("Warehouse 2 - Main Branch")).toBeInTheDocument();
  });

  it("asks which warehouse once the chosen branch has more than one", async () => {
    vi.mocked(warehousesService.list).mockResolvedValue([
      ...warehouseRows,
      { id: "w3", branch_id: "b1", name: "Warehouse 2 - Main Branch", is_default: false },
    ]);
    const create = vi.spyOn(buyingService, "createRicePurchase").mockResolvedValue({ id: "p1" });
    useAuthStore.setState({ user: owner });
    draw(<RicePurchasesPage />);
    fireEvent.click(screen.getByRole("button", { name: /New Purchase/ }));

    await chooseOption("Variety", "RC222");
    // The branch's first is already picked.
    await waitFor(() =>
      expect(screen.getByLabelText("Store in warehouse")).toHaveTextContent(
        "Warehouse 1 - Main Branch",
      ),
    );
    await chooseOption("Store in warehouse", "Warehouse 2 - Main Branch");
    await chooseOption("Grade", "Broken Rice");
    fireEvent.change(screen.getByPlaceholderText("Sacks"), { target: { value: "20" } });
    fireEvent.change(screen.getByPlaceholderText("₱/sack"), { target: { value: "2400" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Purchase" }));

    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0][0]).toMatchObject({ branch_id: "b1", warehouse_id: "w3" });
  });

  it("doesn't ask which warehouse in a branch that has just the one", async () => {
    vi.mocked(warehousesService.list).mockResolvedValue([
      ...warehouseRows,
      { id: "w3", branch_id: "b1", name: "Warehouse 2 - Main Branch", is_default: false },
    ]);
    useAuthStore.setState({ user: owner });
    draw(<RicePurchasesPage />);
    fireEvent.click(screen.getByRole("button", { name: /New Purchase/ }));
    await screen.findByLabelText("Store in warehouse");

    await chooseOption("Branch", "2nd Branch");
    expect(screen.queryByLabelText("Store in warehouse")).toBeNull();
  });

  it("doesn't offer an encoder the branch choice", async () => {
    useAuthStore.setState({ user: encoder });
    draw(<RicePurchasesPage />);
    fireEvent.click(screen.getByRole("button", { name: /New Purchase/ }));
    expect(screen.queryByLabelText("Branch")).toBeNull();
  });
});

describe("By-products page", () => {
  it("says what is missing when saving without it, and saves nothing", () => {
    const create = vi
      .spyOn(buyingService, "createByproductPurchase")
      .mockResolvedValue({ id: "p1" });
    useAuthStore.setState({ user: owner });
    draw(<ByproductPurchasesPage />);
    fireEvent.click(screen.getByRole("button", { name: /New Purchase/ }));

    fireEvent.click(screen.getByRole("button", { name: "Save Purchase" }));

    expect(screen.getAllByTestId("field-error").map((n) => n.textContent)).toEqual([
      "This field needs an input.", // the weight
      "This field needs an input.", // the price
    ]);
    expect(create).not.toHaveBeenCalled();
  });

  it("records a by-product by weight, without variety or grade", async () => {
    const create = vi
      .spyOn(buyingService, "createByproductPurchase")
      .mockResolvedValue({ id: "p1" });
    useAuthStore.setState({ user: owner });
    draw(<ByproductPurchasesPage />);
    fireEvent.click(screen.getByRole("button", { name: /New Purchase/ }));

    expect(screen.queryByLabelText("Variety")).toBeNull();
    expect(screen.queryByLabelText("Grade")).toBeNull();
    await chooseOption("By-product", "Darak (Rice Bran)");
    fireEvent.change(screen.getByPlaceholderText("kg"), { target: { value: "500" } });
    fireEvent.change(screen.getByPlaceholderText("₱/kg"), { target: { value: "14" } });
    expect(screen.getByTestId("byproduct-total")).toHaveTextContent("₱7,000.00");

    fireEvent.click(screen.getByRole("button", { name: "Save Purchase" }));
    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0][0]).toMatchObject({
      branch_id: "b1",
      items: [{ byproduct_type: "darak", weight_kg: "500", price_per_kg: "14" }],
    });
  });
});
