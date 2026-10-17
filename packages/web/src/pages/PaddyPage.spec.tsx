import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { User } from "@rice-mill/shared";
import PaddyPage from "./PaddyPage";
import { useAuthStore } from "../stores/authStore";
import { paddyService } from "../services/PaddyService";
import { inventoryService } from "../services/InventoryService";
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

const warehouses = [
  { id: "b2", name: "2nd Branch", is_main_branch: false },
  { id: "b1", name: "Main Branch", is_main_branch: true },
];

const draw = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <PaddyPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

let create: ReturnType<typeof vi.spyOn>;
let listBranches: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.spyOn(paddyService, "listPurchases").mockResolvedValue([]);
  vi.spyOn(paddyService, "listVarieties").mockResolvedValue([{ id: "v1", code: "RC222" }]);
  vi.spyOn(paddyService, "listGrades").mockResolvedValue([]);
  vi.spyOn(paddyService, "listInventory").mockResolvedValue([]);
  create = vi.spyOn(paddyService, "createPurchase").mockResolvedValue({ id: "p1" });
  listBranches = vi.spyOn(inventoryService, "getBranches").mockResolvedValue(warehouses);
});

afterEach(() => {
  vi.restoreAllMocks();
  useAuthStore.setState({ user: null });
});

const fillAndSave = () => {
  fireEvent.change(screen.getByPlaceholderText("Gross kg"), { target: { value: "1000" } });
  fireEvent.change(screen.getByPlaceholderText("₱/cavan"), { target: { value: "1200" } });
  fireEvent.click(screen.getByRole("button", { name: "Save Purchase" }));
};

describe("PaddyPage: which warehouse a new purchase is stored in", () => {
  it("lets the owner pick the warehouse, starting on their own", async () => {
    useAuthStore.setState({ user: owner });
    draw();
    fireEvent.click(screen.getByRole("button", { name: /New Purchase/ }));

    await waitFor(() =>
      expect(screen.getByLabelText("Store in warehouse")).toHaveTextContent("Main Branch (Main)"),
    );
    await chooseOption("Store in warehouse", "2nd Branch");
    fillAndSave();

    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0][0]).toMatchObject({ branch_id: "b2" });
  });

  it("saves to the owner's own warehouse when they leave it as it is", async () => {
    useAuthStore.setState({ user: owner });
    draw();
    fireEvent.click(screen.getByRole("button", { name: /New Purchase/ }));
    await screen.findByLabelText("Store in warehouse");
    fillAndSave();

    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0][0]).toMatchObject({ branch_id: "b1" });
  });

  it("doesn't offer the choice to an encoder; their purchases go to their own warehouse", async () => {
    useAuthStore.setState({ user: encoder });
    draw();
    fireEvent.click(screen.getByRole("button", { name: /New Purchase/ }));
    expect(screen.queryByLabelText("Store in warehouse")).toBeNull();
    expect(listBranches).not.toHaveBeenCalled();
    fillAndSave();

    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0][0]).toMatchObject({ branch_id: null });
  });

  it("names the warehouse in the stock table once palay sits in more than one", async () => {
    vi.mocked(paddyService.listInventory).mockResolvedValue([
      {
        id: "i1",
        branch_id: "b1",
        branch: { name: "Main Branch" },
        variety: { code: "RC222" },
        quantity_kg: 500,
      },
      {
        id: "i2",
        branch_id: "b2",
        branch: { name: "2nd Branch" },
        variety: { code: "RC222" },
        quantity_kg: 300,
      },
    ]);
    useAuthStore.setState({ user: owner });
    draw();

    const stock = screen.getByTestId("palay-stock-index");
    expect(
      await within(stock).findByRole("columnheader", { name: "Warehouse" }),
    ).toBeInTheDocument();
    expect(within(stock).getByText("2nd Branch")).toBeInTheDocument();
  });
});
