import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ByproductsList } from "./CatalogLists";
import { byproductKindService, type ByproductKind } from "../../services/ByproductKindService";
import { byproductLabel } from "../../mappers/byproductNames";

const builtIn = (code: string, name: string): ByproductKind => ({
  id: null,
  code,
  name,
  built_in: true,
  is_active: true,
});
const KINDS: ByproductKind[] = [
  builtIn("ipa", "Ipa (Rice Hull)"),
  builtIn("darak", "Darak (Rice Bran)"),
  builtIn("binlid", "Binlid (Broken Rice)"),
  { id: "d1", code: "darak_d1", name: "First-class bran", built_in: false, is_active: true },
  { id: "ash", code: "hull_ash", name: "Hull ash", built_in: false, is_active: false },
];

const draw = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ByproductsList />
    </QueryClientProvider>,
  );

describe("Catalog: By-products", () => {
  beforeEach(() => {
    vi.spyOn(byproductKindService, "list").mockResolvedValue(KINDS);
    vi.spyOn(byproductKindService, "create").mockResolvedValue(KINDS[3]);
    vi.spyOn(byproductKindService, "update").mockResolvedValue(KINDS[3]);
  });
  afterEach(() => vi.restoreAllMocks());

  it("lists every mill's three, which stay, and the mill's own, which it can change", async () => {
    draw();
    const own = (await screen.findByText("First-class bran")).closest("tr")!;
    expect(within(own).getByText("Custom")).toBeInTheDocument();
    expect(within(own).getByRole("button", { name: "Edit First-class bran" })).toBeInTheDocument();

    const ipa = screen.getByText("Ipa (Rice Hull)").closest("tr")!;
    expect(within(ipa).getByText("Default")).toBeInTheDocument();
    expect(within(ipa).queryByRole("button")).not.toBeInTheDocument();

    const ash = screen.getByText("Hull ash").closest("tr")!;
    expect(within(ash).getByText("Hidden")).toBeInTheDocument();
    fireEvent.click(within(ash).getByRole("button", { name: "Unhide Hull ash" }));
    await waitFor(() =>
      expect(byproductKindService.update).toHaveBeenCalledWith("ash", { is_active: true }),
    );
  });

  it("adds one and renames one", async () => {
    draw();
    await screen.findByText("First-class bran");

    fireEvent.click(screen.getByRole("button", { name: /Add by-product/ }));
    fireEvent.change(screen.getByLabelText("Name *"), { target: { value: " Tahop " } });
    fireEvent.click(screen.getByRole("button", { name: "Save by-product" }));
    await waitFor(() => expect(byproductKindService.create).toHaveBeenCalledWith("Tahop"));

    fireEvent.click(screen.getByRole("button", { name: "Edit First-class bran" }));
    fireEvent.change(screen.getByLabelText("By-product name"), { target: { value: "Darak D1" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(byproductKindService.update).toHaveBeenCalledWith("d1", { name: "Darak D1" }),
    );
  });

  it("teaches the other pages the names it loads", async () => {
    expect(byproductLabel("rice_straw")).toBe("Rice straw");
    draw();
    await screen.findByText("First-class bran");
    expect(byproductLabel("darak_d1")).toBe("First-class bran");
    expect(byproductLabel("darak")).toBe("Darak (Rice Bran)");
  });
});
