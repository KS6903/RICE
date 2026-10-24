import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { User } from "@rice-mill/shared";
import { ExpenseCategoriesList } from "./CatalogLists";
import { useAuthStore } from "../../stores/authStore";
import { costsService } from "../../services/CostsService";

const owner: User = {
  id: "u1",
  username: "mill1",
  full_name: "Mill Owner",
  role: "owner",
  company_id: "c1",
  features: [],
};

const fuel = {
  id: "fuel",
  company_id: "c1",
  name: "Fuel",
  is_production_cost: true,
  is_default: true,
  expense_count: 3,
};
const snacks = {
  id: "snacks",
  company_id: "c1",
  name: "Snacks",
  is_production_cost: false,
  is_default: false,
  expense_count: 0,
};
const generator = { ...snacks, id: "gen", name: "Generator", expense_count: 2 };

const draw = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <ExpenseCategoriesList />
      </MemoryRouter>
    </QueryClientProvider>,
  );

const openTab = async () => {
  draw();
  await screen.findByText("Fuel");
};

describe("Catalog: Expense categories", () => {
  beforeEach(() => {
    useAuthStore.setState({ user: owner });
    vi.spyOn(costsService, "listCategories").mockResolvedValue([fuel, snacks, generator]);
    vi.spyOn(costsService, "updateCategory").mockResolvedValue({});
    vi.spyOn(costsService, "deleteCategory").mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useAuthStore.setState({ user: null });
  });

  it("lets a default be edited but not deleted", async () => {
    await openTab();
    expect(screen.getByRole("button", { name: "Edit Fuel" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete Fuel" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete Snacks" })).toBeInTheDocument();
    expect(screen.getByText("Default")).toBeInTheDocument();
  });

  it("renames a default and changes its type", async () => {
    await openTab();
    fireEvent.click(screen.getByRole("button", { name: "Edit Fuel" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Category name" }), {
      target: { value: "Diesel " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(costsService.updateCategory).toHaveBeenCalledWith("fuel", {
        name: "Diesel",
        is_production_cost: true,
      }),
    );
  });

  it("deletes an unused category after the confirmation", async () => {
    await openTab();
    fireEvent.click(screen.getByRole("button", { name: "Delete Snacks" }));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText("No expense is filed under it.")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() =>
      expect(costsService.deleteCategory).toHaveBeenCalledWith("snacks", undefined),
    );
  });

  it("moves a category's expenses to a default before deleting it", async () => {
    await openTab();
    fireEvent.click(screen.getByRole("button", { name: "Delete Generator" }));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText(/2 expenses are filed under it/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Move and delete" }));

    await waitFor(() => expect(costsService.deleteCategory).toHaveBeenCalledWith("gen", "fuel"));
  });
});
