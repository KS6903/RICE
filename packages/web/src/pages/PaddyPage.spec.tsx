import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { User } from "@rice-mill/shared";
import PaddyPage from "./PaddyPage";
import { useAuthStore } from "../stores/authStore";
import { paddyService } from "../services/PaddyService";
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

const warehouses = [
  { id: "b2", name: "2nd Branch", is_main_branch: false },
  { id: "b1", name: "Main Branch", is_main_branch: true },
];

const warehouseRows = [
  { id: "w1", branch_id: "b1", name: "Warehouse 1 - Main Branch", is_default: true },
  { id: "w2", branch_id: "b2", name: "Warehouse 1 - 2nd Branch", is_default: true },
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
  setView = vi.spyOn(paddyService, "setStockView").mockResolvedValue("kilos");
  create = vi.spyOn(paddyService, "createPurchase").mockResolvedValue({ id: "p1" });
  listBranches = vi.spyOn(inventoryService, "getBranches").mockResolvedValue(warehouses);
  vi.spyOn(warehousesService, "list").mockResolvedValue(warehouseRows);
});

afterEach(() => {
  vi.restoreAllMocks();
  useAuthStore.setState({ user: null });
});

const fillAndSave = () => {
  fireEvent.change(screen.getByLabelText("Kilos"), { target: { value: "1000" } });
  fireEvent.change(screen.getByPlaceholderText("₱/kg"), { target: { value: "24" } });
  fireEvent.click(screen.getByRole("button", { name: "Save Purchase" }));
};

describe("PaddyPage: which branch and warehouse a new purchase is stored in", () => {
  it("lets the owner pick the branch, starting on their own", async () => {
    useAuthStore.setState({ user: owner });
    draw();
    fireEvent.click(screen.getByRole("button", { name: /New Purchase/ }));

    await waitFor(() =>
      expect(screen.getByLabelText("Branch")).toHaveTextContent("Main Branch (Main)"),
    );
    await chooseOption("Branch", "2nd Branch");
    fillAndSave();

    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0][0]).toMatchObject({ branch_id: "b2" });
  });

  it("saves to the owner's own branch when they leave it as it is", async () => {
    useAuthStore.setState({ user: owner });
    draw();
    fireEvent.click(screen.getByRole("button", { name: /New Purchase/ }));
    await screen.findByLabelText("Branch");
    fillAndSave();

    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0][0]).toMatchObject({ branch_id: "b1" });
  });

  it("doesn't offer the choice to an encoder; their purchases go to their own branch", async () => {
    useAuthStore.setState({ user: encoder });
    draw();
    fireEvent.click(screen.getByRole("button", { name: /New Purchase/ }));
    expect(screen.queryByLabelText("Branch")).toBeNull();
    expect(listBranches).not.toHaveBeenCalled();
    fillAndSave();

    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0][0]).toMatchObject({ branch_id: null });
  });

  it("names the branch in the stock table once palay sits in more than one", async () => {
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
    expect(await within(stock).findByRole("columnheader", { name: "Branch" })).toBeInTheDocument();
    expect(within(stock).queryByRole("columnheader", { name: "Warehouse" })).toBeNull();
    expect(within(stock).getByText("2nd Branch")).toBeInTheDocument();
  });

  it("names the warehouse too once a branch's palay sits in more than one", async () => {
    vi.mocked(paddyService.listInventory).mockResolvedValue([
      {
        id: "i1",
        branch_id: "b1",
        warehouse_id: "w1",
        branch: { name: "Main Branch" },
        warehouse: { name: "Warehouse 1 - Main Branch" },
        variety: { code: "RC222" },
        quantity_kg: 500,
      },
      {
        id: "i2",
        branch_id: "b1",
        warehouse_id: "w3",
        branch: { name: "Main Branch" },
        warehouse: { name: "Warehouse 2 - Main Branch" },
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
    expect(within(stock).queryByRole("columnheader", { name: "Branch" })).toBeNull();
    expect(within(stock).getByText("Warehouse 2 - Main Branch")).toBeInTheDocument();
  });

  it("asks which warehouse once the branch has more than one, and sends the pick", async () => {
    vi.mocked(warehousesService.list).mockResolvedValue([
      ...warehouseRows,
      { id: "w3", branch_id: "b1", name: "Warehouse 2 - Main Branch", is_default: false },
    ]);
    useAuthStore.setState({ user: owner });
    draw();
    fireEvent.click(screen.getByRole("button", { name: /New Purchase/ }));
    await waitFor(() =>
      expect(screen.getByLabelText("Store in warehouse")).toHaveTextContent(
        "Warehouse 1 - Main Branch",
      ),
    );
    await chooseOption("Store in warehouse", "Warehouse 2 - Main Branch");
    fillAndSave();

    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0][0]).toMatchObject({ branch_id: "b1", warehouse_id: "w3" });
  });
});

describe("PaddyPage: a purchase line in cavans or kilos, bought wet or dry", () => {
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

  it("asks for no sacks, and calls nothing an estimate", async () => {
    open();
    await screen.findByLabelText("Cavans");
    expect(screen.queryByLabelText("Sacks")).toBeNull();
    expect(screen.queryByText(/\(est\.\)|estimated/)).toBeNull();
    expect(screen.getByLabelText("Tare (kg)")).toBeInTheDocument();
  });

  it("keeps the cavans and the kilos the same amount, whichever is typed", async () => {
    open();
    const cavans = await screen.findByLabelText("Cavans");
    const kilos = screen.getByLabelText("Kilos");

    fireEvent.change(cavans, { target: { value: "20" } });
    expect(kilos).toHaveValue(1000);

    fireEvent.change(kilos, { target: { value: "1250" } });
    expect(cavans).toHaveValue(25);

    fireEvent.change(cavans, { target: { value: "" } });
    expect(kilos).toHaveValue(null);
  });

  it("saves a line with the cavans and the price, the kilos worked out", async () => {
    open();
    fireEvent.change(await screen.findByLabelText("Cavans"), { target: { value: "20" } });
    fireEvent.change(screen.getByPlaceholderText("₱/kg"), { target: { value: "24" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Purchase" }));

    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0][0].items[0]).toMatchObject({
      cavan_count: "20",
      gross_weight_kg: "1000",
      price_per_kg: "24",
      is_wet: false,
    });
  });

  it("says what a line still needs when saving with it missing, and saves nothing", async () => {
    open();
    const save = await screen.findByRole("button", { name: "Save Purchase" });
    expect(screen.queryByTestId("field-error")).toBeNull();

    fireEvent.click(save);

    const notices = screen.getAllByTestId("field-error").map((n) => n.textContent);
    expect(notices).toEqual(["Enter the cavans or kilos.", "This field needs an input."]);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Some fields still need an input. Fill in the ones marked in red.",
    );
    expect(create).not.toHaveBeenCalled();

    // Each notice goes once its field is filled in.
    fireEvent.change(screen.getByLabelText("Cavans"), { target: { value: "20" } });
    expect(screen.getAllByTestId("field-error").map((n) => n.textContent)).toEqual([
      "This field needs an input.",
    ]);
    fireEvent.change(screen.getByPlaceholderText("₱/kg"), { target: { value: "24" } });
    expect(screen.queryByTestId("field-error")).toBeNull();
    fireEvent.click(save);
    await waitFor(() => expect(create).toHaveBeenCalled());
  });

  it("starts the variety and grade on a prompt, and lists the grades A to Z", async () => {
    vi.spyOn(paddyService, "listGrades").mockResolvedValue([
      { id: "g3", code: "NFA2" },
      { id: "g1", code: "A" },
      { id: "g4", code: "Premium" },
      { id: "g2", code: "B" },
    ]);
    open();
    expect(await screen.findByLabelText("Grade")).toHaveTextContent("-- Select Grade --");
    expect(screen.getByLabelText("Variety")).toHaveTextContent("-- Select Variety --");

    await waitFor(() => {
      if (!screen.queryByRole("listbox")) fireEvent.click(screen.getByLabelText("Grade"));
      expect(screen.getByRole("option", { name: "Premium" })).toBeInTheDocument();
    });
    const options = within(screen.getByRole("listbox")).getAllByRole("option");
    expect(options.map((o) => o.textContent?.trim())).toEqual(["A", "B", "NFA2", "Premium"]);
  });

  it("takes the price per kilo and works out the price per cavan from it", async () => {
    open();
    const perCavan = await screen.findByLabelText("Price per cavan (₱)");
    expect(perCavan).toHaveAttribute("readonly");
    expect(perCavan).toHaveValue("");

    fireEvent.change(screen.getByLabelText("Price per kg (₱)"), { target: { value: "24.5" } });
    expect(perCavan).toHaveValue("1,225"); // 50 kg to the cavan
  });

  it("saves wet palay as Wet, with nothing asked about its drying, and no red", async () => {
    open();
    expect(await screen.findByRole("checkbox", { name: "Dry" })).toBeChecked();

    fireEvent.click(screen.getByRole("checkbox", { name: "Wet" }));
    expect(screen.getByRole("checkbox", { name: "Wet" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Dry" })).not.toBeChecked();
    expect(screen.getByLabelText("Moisture when wet %")).toBeInTheDocument();
    // Its drying is recorded later, from the purchase's details.
    expect(screen.queryByLabelText("Weight after drying (kg)")).toBeNull();
    expect(screen.queryByLabelText("Moisture after drying %")).toBeNull();
    expect(screen.getByText(/Wet palay is saved as Wet/)).toBeInTheDocument();
    // The line isn't outlined or boxed in red, and the words Wet and Dry aren't coloured.
    expect(screen.getByTestId("purchase-line").className).not.toMatch(/rose|red/);
    expect(screen.getByText("Wet").className).not.toMatch(/rose|red|emerald/);
    expect(screen.getByText("Dry").className).not.toMatch(/rose|red|emerald/);

    fireEvent.change(screen.getByLabelText("Cavans"), { target: { value: "20" } });
    fireEvent.change(screen.getByPlaceholderText("₱/kg"), { target: { value: "24" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Purchase" }));

    await waitFor(() => expect(create).toHaveBeenCalled());
    const line = create.mock.calls[0][0].items[0];
    expect(line).toMatchObject({ is_wet: true, cavan_count: "20", price_per_kg: "24" });
    expect(line).not.toHaveProperty("dried_weight_kg");
  });
});

describe("PaddyPage: its own To do window (Pro plans and up)", () => {
  it("puts a To do button at the top right of the page's title, for a plan that has it", () => {
    useAuthStore.setState({ user: { ...owner, features: ["paddy", "page_todo"] } });
    draw();

    const button = screen.getByTestId("palay-todo-button");
    expect(button).toHaveTextContent("To do");
    // In the same row as the title and its line, after them.
    const header = screen.getByRole("heading", { name: "Palay (Paddy)" }).parentElement
      ?.parentElement as HTMLElement;
    expect(header).toContainElement(button);
    expect(header.lastElementChild).toContainElement(button);
    expect(button.parentElement?.lastElementChild).toBe(button);
    expect(header.className).toMatch(/items-center/);
  });

  it("has no To do button on a plan without it", () => {
    useAuthStore.setState({ user: { ...owner, features: ["paddy"] } });
    draw();

    expect(screen.queryByTestId("palay-todo-button")).toBeNull();
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

  // What a cell says: the other unit is there too, faded out, to hold the width.
  const said = (el: HTMLElement) =>
    Array.from(el.querySelectorAll<HTMLElement>("span.inline-grid > span"))
      .filter((s) => !s.hasAttribute("aria-hidden"))
      .map((s) => s.textContent)
      .join(" ") || el.textContent;

  it("shows the cavans when a mill has picked nothing, or sacks or all before", async () => {
    useAuthStore.setState({ user: encoder });
    draw();

    const row = (await within(stockTable()).findByText("NSIC Rc 222")).closest("tr") as HTMLElement;
    const headers = within(stockTable()).getAllByRole("columnheader");
    expect(headers.map(said)).toEqual(["Variety", "Grade", "Cavans"]);
    expect(within(row).getAllByRole("cell").map(said).slice(1)).toEqual(["—", "20"]);
    expect(within(row).getByText("5 cavans wet")).toBeInTheDocument();
  });

  it("on a phone puts the grade, branch and wet palay under the variety, the amounts beside it", async () => {
    vi.spyOn(window, "matchMedia").mockImplementation(
      (query) =>
        ({
          matches: query.includes("max-width: 639px"),
          media: query,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
        }) as unknown as MediaQueryList,
    );
    vi.mocked(paddyService.listInventory).mockResolvedValue([
      { ...stock[0], grade: { code: "A" } },
      { ...stock[0], id: "i2", branch_id: "b2", branch: { name: "2nd Branch" }, wet_kg: 0 },
    ]);
    useAuthStore.setState({ user: encoder });
    draw();

    const headers = await within(stockTable()).findAllByRole("columnheader");
    // No Grade or Branch column.
    expect(headers.map(said)).toEqual(["Variety", "Cavans"]);
    const grade = await within(stockTable()).findByText("A · Main Branch");
    const first = grade.closest("td") as HTMLElement;
    expect(first).toHaveTextContent("NSIC Rc 222");
    expect(within(first).getByText("5 cavans wet")).toBeInTheDocument();
    const second = within(stockTable()).getByText("2nd Branch").closest("td") as HTMLElement;
    expect(second).toHaveTextContent("NSIC Rc 222");
    expect(within(second).queryByText(/wet/)).toBeNull();
  });

  it("shows the kilos when that's what the Boss picked, on every screen", async () => {
    vi.mocked(paddyService.getStockView).mockResolvedValue("kilos");
    useAuthStore.setState({ user: encoder });
    draw();

    const row = (await within(stockTable()).findByText("NSIC Rc 222")).closest("tr") as HTMLElement;
    await waitFor(() => expect(said(within(row).getAllByRole("cell")[2])).toBe("1,000"));
    expect(within(stockTable()).getAllByRole("columnheader").map(said)).toEqual([
      "Variety",
      "Grade",
      "Kilos",
    ]);
  });

  it("switches at the click, keeping both in the cell so nothing moves", async () => {
    useAuthStore.setState({ user: owner });
    draw();
    const views = await screen.findByRole("radiogroup", { name: "View by" });
    const row = (await within(stockTable()).findByText("NSIC Rc 222")).closest("tr") as HTMLElement;
    const figure = within(row).getAllByRole("cell")[2];
    expect(figure).toHaveTextContent("201,000");

    fireEvent.click(within(views).getByRole("radio", { name: "Kilos" }));

    // Without waiting for the server's answer.
    expect(said(figure)).toBe("1,000");
    expect(figure).toHaveTextContent("201,000");
    expect(within(views).getByRole("radio", { name: "Kilos" })).toBeChecked();
    await waitFor(() => expect(setView).toHaveBeenCalledWith("kilos"));
  });

  it("goes back when the choice couldn't be saved", async () => {
    setView.mockRejectedValue(new Error("offline"));
    useAuthStore.setState({ user: owner });
    draw();
    const views = await screen.findByRole("radiogroup", { name: "View by" });
    await within(stockTable()).findByText("NSIC Rc 222");

    fireEvent.click(within(views).getByRole("radio", { name: "Kilos" }));

    await waitFor(() => expect(within(views).getByRole("radio", { name: "Cavans" })).toBeChecked());
  });

  it("lets only the Boss change it, between the cavans and the kilos", async () => {
    useAuthStore.setState({ user: encoder });
    const { unmount } = draw();
    await within(stockTable()).findByText("NSIC Rc 222");
    expect(screen.queryByRole("radiogroup", { name: "View by" })).toBeNull();
    unmount();

    useAuthStore.setState({ user: owner });
    draw();
    const views = await screen.findByRole("radiogroup", { name: "View by" });
    expect(
      within(views)
        .getAllByRole("radio")
        .map((r) => r.textContent),
    ).toEqual(["Cavans", "Kilos"]);
    expect(within(views).getByRole("radio", { name: "Cavans" })).toBeChecked();
  });
});
