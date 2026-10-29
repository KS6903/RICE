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
let setView: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.spyOn(paddyService, "listPurchases").mockResolvedValue([]);
  vi.spyOn(paddyService, "listVarieties").mockResolvedValue([
    {
      id: "v1",
      code: "NSIC Rc 222",
      name: "NSIC Rc 222 (Tubigan 18, Triple Two)",
      kind: "palay",
    },
    { id: "v2", code: "Dinorado", name: "Dinorado", kind: "rice" },
  ]);
  vi.spyOn(paddyService, "listGrades").mockResolvedValue([]);
  vi.spyOn(paddyService, "listInventory").mockResolvedValue([]);
  vi.spyOn(paddyService, "getStockView").mockResolvedValue("all");
  setView = vi.spyOn(paddyService, "setStockView").mockResolvedValue("sacks");
  create = vi.spyOn(paddyService, "createPurchase").mockResolvedValue({ id: "p1" });
  listBranches = vi.spyOn(inventoryService, "getBranches").mockResolvedValue(warehouses);
});

afterEach(() => {
  vi.restoreAllMocks();
  useAuthStore.setState({ user: null });
});

const fillAndSave = () => {
  fireEvent.change(screen.getByLabelText("Kilos (est.)"), { target: { value: "1000" } });
  fireEvent.change(screen.getByPlaceholderText("₱/kg"), { target: { value: "24" } });
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

describe("PaddyPage: a purchase line counted in sacks, bought wet or dry", () => {
  const open = () => {
    useAuthStore.setState({ user: owner });
    draw();
    fireEvent.click(screen.getByRole("button", { name: /New Purchase/ }));
  };

  it("offers the palay varieties with their other names, and not the rice ones", async () => {
    open();
    // The list opens once the varieties have loaded: keep clicking until it does.
    await waitFor(() => {
      if (!screen.queryByRole("listbox"))
        fireEvent.click(screen.getByRole("button", { name: "Variety" }));
      expect(
        screen.getByRole("option", { name: "NSIC Rc 222 (Tubigan 18, Triple Two)" }),
      ).toBeInTheDocument();
    });
    const options = within(screen.getByRole("listbox")).getAllByRole("option");
    expect(options.map((o) => o.textContent?.trim())).toEqual([
      "NSIC Rc 222 (Tubigan 18, Triple Two)",
    ]);
  });

  it("saves a line with only the sacks and the price: cavans and kilos are optional", async () => {
    open();
    fireEvent.change(await screen.findByLabelText("Sacks"), { target: { value: "20" } });
    expect(screen.getByRole("button", { name: "Save Purchase" })).toBeDisabled(); // no price yet
    fireEvent.change(screen.getByPlaceholderText("₱/kg"), { target: { value: "24" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Purchase" }));

    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0][0].items[0]).toMatchObject({
      sack_count: "20",
      cavan_count: "",
      gross_weight_kg: "",
      price_per_kg: "24",
      is_wet: false,
    });
  });

  it("takes the price per kilo and works out the price per cavan from it", async () => {
    open();
    const perCavan = await screen.findByLabelText("Price per cavan (₱)");
    expect(perCavan).toHaveAttribute("readonly");
    expect(perCavan).toHaveValue("");

    fireEvent.change(screen.getByLabelText("Price per kg (₱)"), { target: { value: "24.5" } });
    expect(perCavan).toHaveValue("1,225"); // 50 kg to the cavan
  });

  it("requires the weight and moisture after drying once the line is wet, and no red", async () => {
    open();
    expect(await screen.findByRole("checkbox", { name: "Dry" })).toBeChecked();
    expect(screen.queryByLabelText("Weight after drying (kg)")).toBeNull();

    fireEvent.click(screen.getByRole("checkbox", { name: "Wet" }));
    expect(screen.getByRole("checkbox", { name: "Wet" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Dry" })).not.toBeChecked();
    expect(screen.getByLabelText("Moisture before drying %")).toBeInTheDocument();
    // The line and its drying figures aren't outlined or boxed in red.
    expect(screen.getByTestId("purchase-line").className).not.toMatch(/rose|red/);
    expect(
      screen.getByLabelText("Weight after drying (kg)").closest("div.grid")?.className,
    ).not.toMatch(/rose|red/);

    const save = screen.getByRole("button", { name: "Save Purchase" });
    fireEvent.change(screen.getByLabelText("Sacks"), { target: { value: "20" } });
    fireEvent.change(screen.getByPlaceholderText("₱/kg"), { target: { value: "24" } });
    expect(save).toBeDisabled(); // nothing after drying yet
    fireEvent.change(screen.getByLabelText("Weight after drying (kg)"), {
      target: { value: "800" },
    });
    expect(save).toBeDisabled(); // still no moisture after drying
    fireEvent.change(screen.getByLabelText("Moisture after drying %"), { target: { value: "14" } });
    expect(save).toBeEnabled();
    fireEvent.click(save);

    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0][0].items[0]).toMatchObject({
      is_wet: true,
      dried_weight_kg: "800",
      dried_moisture_pct: "14",
    });
  });

  it("clears the after-drying figures when the line goes back to dry", async () => {
    open();
    fireEvent.click(await screen.findByRole("checkbox", { name: "Wet" }));
    fireEvent.change(screen.getByLabelText("Weight after drying (kg)"), {
      target: { value: "800" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "Dry" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Wet" }));
    expect(screen.getByLabelText("Weight after drying (kg)")).toHaveValue(null);
  });
});

describe("PaddyPage: how the palay in stock is counted", () => {
  const stock = [
    {
      id: "i1",
      branch_id: "b1",
      branch: { name: "Main Branch" },
      variety: { code: "NSIC Rc 222" },
      quantity_kg: 1000,
      quantity_cavans: 20,
      quantity_sacks: 18.5,
      wet_kg: 250,
      wet_cavans: 5,
      wet_sacks: 4.6,
    },
  ];
  const stockTable = () => screen.getByTestId("palay-stock-index");

  beforeEach(() => {
    vi.mocked(paddyService.listInventory).mockResolvedValue(stock);
  });

  it("shows sacks, cavans and kilos by default, the sacks first", async () => {
    useAuthStore.setState({ user: encoder });
    draw();

    const headers = await within(stockTable()).findAllByRole("columnheader");
    expect(headers.map((h) => h.textContent)).toEqual([
      "Variety",
      "Grade",
      "Sacks",
      "Cavans (est.)",
      "Kilos (est.)",
    ]);
    const row = (await within(stockTable()).findByText("NSIC Rc 222")).closest("tr") as HTMLElement;
    expect(
      within(row)
        .getAllByRole("cell")
        .map((c) => c.textContent),
    ).toEqual(["NSIC Rc 222" + "4.6 sacks wet", "—", "18.5", "20", "1,000"]);
    // Phones show the sacks alone: the other two columns are hidden below the sm breakpoint.
    expect(headers[3]).toHaveClass("hidden", "sm:table-cell");
    expect(headers[2]).not.toHaveClass("hidden");
  });

  it("leaves out the cavans when they read the same as the sacks on every row", async () => {
    vi.mocked(paddyService.listInventory).mockResolvedValue([
      { ...stock[0], quantity_sacks: 20, quantity_cavans: 20, quantity_kg: 1000 },
      { ...stock[0], id: "i2", quantity_sacks: 268.3, quantity_cavans: 268.3, quantity_kg: 13417 },
    ]);
    useAuthStore.setState({ user: encoder });
    draw();

    await waitFor(() =>
      expect(
        within(stockTable())
          .getAllByRole("columnheader")
          .map((h) => h.textContent),
      ).toEqual(["Variety", "Grade", "Sacks", "Kilos (est.)"]),
    );
  });

  it("keeps the cavans as soon as one row's differ from its sacks", async () => {
    vi.mocked(paddyService.listInventory).mockResolvedValue([
      { ...stock[0], quantity_sacks: 20, quantity_cavans: 20 },
      { ...stock[0], id: "i2", quantity_sacks: 18.5, quantity_cavans: 20 },
    ]);
    useAuthStore.setState({ user: encoder });
    draw();

    await waitFor(() =>
      expect(
        within(stockTable())
          .getAllByRole("columnheader")
          .map((h) => h.textContent),
      ).toEqual(["Variety", "Grade", "Sacks", "Cavans (est.)", "Kilos (est.)"]),
    );
  });

  it("shows only the one the Boss picked, on every screen", async () => {
    vi.mocked(paddyService.getStockView).mockResolvedValue("cavans");
    useAuthStore.setState({ user: encoder });
    draw();

    await waitFor(() =>
      expect(
        within(stockTable())
          .getAllByRole("columnheader")
          .map((h) => h.textContent),
      ).toEqual(["Variety", "Grade", "Cavans (est.)"]),
    );
    const headers = within(stockTable()).getAllByRole("columnheader");
    expect(headers.some((h) => h.className.includes("hidden"))).toBe(false);
    expect(await within(stockTable()).findByText("5 cavans wet")).toBeInTheDocument();
  });

  it("lets only the Boss change it", async () => {
    useAuthStore.setState({ user: encoder });
    const { unmount } = draw();
    await within(stockTable()).findByText("NSIC Rc 222");
    expect(screen.queryByLabelText("Count palay in")).toBeNull();
    unmount();

    useAuthStore.setState({ user: owner });
    draw();
    await chooseOption("Count palay in", "Sacks");
    await waitFor(() => expect(setView).toHaveBeenCalledWith("sacks"));
  });
});
