import { afterEach, describe, expect, it, vi } from "vitest";
import { configure, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { User } from "@rice-mill/shared";
import InventoryPage from "./InventoryPage";
import { useAuthStore } from "../stores/authStore";
import { inventoryService } from "../services/InventoryService";
import { warehousesService } from "../services/WarehousesService";
import { byproductKindService } from "../services/ByproductKindService";
import { stockCountService } from "../services/StockCountService";

configure({ asyncUtilTimeout: 5000 });

const owner: User = {
  id: "u1",
  username: "mill1",
  full_name: "Mill Owner",
  role: "owner",
  company_id: "c1",
  features: ["inventory", "automations"],
};

const draw = (user: User, start = "/inventory") => {
  useAuthStore.setState({ user });
  vi.spyOn(inventoryService, "getBranches").mockResolvedValue([]);
  vi.spyOn(inventoryService, "getMilledRice").mockResolvedValue([]);
  vi.spyOn(inventoryService, "getByproducts").mockResolvedValue([]);
  vi.spyOn(inventoryService, "getPalay").mockResolvedValue([]);
  vi.spyOn(inventoryService, "getSummary").mockResolvedValue({} as never);
  vi.spyOn(warehousesService, "list").mockResolvedValue([]);
  vi.spyOn(byproductKindService, "list").mockResolvedValue([]);
  vi.spyOn(stockCountService, "page").mockResolvedValue({
    sheet: [],
    tolerance_pct: 2,
    manager: true,
    choices: { defaults: {}, lines: {} },
    counts: [],
  });
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[start]}>
        <InventoryPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe("InventoryPage stock count tab", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    useAuthStore.setState({ user: null });
  });

  it("counts from a tab, without the stock list's branch and sort", async () => {
    draw(owner);
    expect(screen.getByLabelText("Sort inventory by")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Stock count" }));
    expect(await screen.findByText("No counts yet.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Sort inventory by")).not.toBeInTheDocument();
  });

  it("lands on the count from a link to the tab", async () => {
    draw(owner, "/inventory?tab=count");
    expect(await screen.findByText("No counts yet.")).toBeInTheDocument();
  });

  it("shows the Boss on a lower plan what the count needs", () => {
    draw({ ...owner, features: ["inventory"] });
    fireEvent.click(screen.getByRole("button", { name: "Stock count" }));
    expect(screen.getByText("Upgrade required")).toBeInTheDocument();
    expect(stockCountService.page).not.toHaveBeenCalled();
  });

  it("shows staff on a lower plan no such tab", () => {
    draw({ ...owner, role: "encoder", features: ["inventory"] });
    expect(screen.queryByRole("button", { name: "Stock count" })).not.toBeInTheDocument();
  });
});
