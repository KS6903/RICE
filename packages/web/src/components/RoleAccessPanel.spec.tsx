import { afterEach, describe, expect, it, vi } from "vitest";
import { configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import RoleAccessPanel from "./RoleAccessPanel";
import { chooseOption } from "../test/pickers";
import {
  roleAccessService,
  type AccessLevel,
  type CustomRoleEntry,
  type RoleAccessData,
} from "../services/RoleAccessService";

configure({ asyncUtilTimeout: 5000 });

const SECTIONS = ["paddy", "inventory", "sales", "reports", "employees"];
const level = (map: Record<string, AccessLevel>) =>
  Object.fromEntries(SECTIONS.map((s) => [s, map[s] ?? "none"])) as Record<string, AccessLevel>;

const everything = level({
  paddy: "full",
  inventory: "full",
  sales: "full",
  reports: "full",
  employees: "full",
});
const cashierDefaults = level({ inventory: "view", sales: "full" });

const keeper: CustomRoleEntry = {
  id: "r1",
  name: "Warehouse Manager",
  access: level({ inventory: "full", reports: "view" }),
  people: 0,
};

const matrix = (
  cashier: Record<string, AccessLevel> = cashierDefaults,
  custom: CustomRoleEntry[] = [],
): RoleAccessData => ({
  sections: SECTIONS,
  roles: [
    { role: "owner", editable: false, access: everything, defaults: everything },
    { role: "admin", editable: true, access: everything, defaults: everything },
    { role: "cashier", editable: true, access: cashier, defaults: cashierDefaults },
  ],
  custom_roles: custom,
});

function draw(data: RoleAccessData = matrix()) {
  const get = vi.spyOn(roleAccessService, "get").mockResolvedValue(data);
  const update = vi.spyOn(roleAccessService, "update");
  vi.spyOn(roleAccessService, "createCustom");
  vi.spyOn(roleAccessService, "updateCustom");
  vi.spyOn(roleAccessService, "deleteCustom");
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RoleAccessPanel />
    </QueryClientProvider>,
  );
  return { get, update };
}

const openPanel = async () => {
  fireEvent.click(screen.getByRole("button", { name: /Who can open what/ }));
  await screen.findByText("Cashier");
};
const chooseCashierPages = () =>
  fireEvent.click(screen.getByRole("button", { name: "Choose what Cashier can open" }));

describe("RoleAccessPanel", () => {
  afterEach(() => vi.restoreAllMocks());

  it("stays put away, and asks the server nothing, until it is opened", async () => {
    const { get } = draw();
    expect(screen.getByRole("button", { name: /Who can open what/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.queryByText("Cashier")).toBeNull();
    expect(get).not.toHaveBeenCalled();

    await openPanel();
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("shows each role, with only the Boss fixed at everything", async () => {
    draw();
    await openPanel();
    const boss = screen.getByText("Boss").closest("li") as HTMLElement;
    expect(within(boss).getByText("Full access")).toBeInTheDocument();
    expect(within(boss).queryByRole("button", { name: /Choose/ })).toBeNull();
    // The Admin can be changed like anyone else.
    expect(screen.getByRole("button", { name: "Choose what Admin can open" })).toBeInTheDocument();

    const cashier = screen.getByText("Cashier").closest("li") as HTMLElement;
    expect(cashier).toHaveTextContent("Opens 2 of 5 pages, and can edit 1.");
    expect(
      screen.getByRole("button", { name: "Choose what Cashier can open" }),
    ).toBeInTheDocument();
  });

  it("opens a page to a role with a tick, and saves it", async () => {
    const { update } = draw();
    update.mockResolvedValue(matrix(level({ inventory: "view", sales: "full", reports: "view" })));
    await openPanel();
    chooseCashierPages();

    const open = screen.getByRole("checkbox", { name: "Cashier can open Reports" });
    const edit = screen.getByRole("checkbox", { name: "Cashier can edit Reports" });
    expect(open).not.toBeChecked();
    // Nothing to edit on a page that isn't open.
    expect(edit).toBeDisabled();
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();

    fireEvent.click(open);
    expect(open).toBeChecked();
    expect(edit).toBeEnabled();
    expect(edit).not.toBeChecked();
    expect(save).toBeEnabled();

    fireEvent.click(save);
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith(
        "cashier",
        level({ inventory: "view", sales: "full", reports: "view" }),
      ),
    );
    // Back to the summary, with what was saved.
    await waitFor(() => expect(screen.queryByRole("checkbox")).toBeNull());
    expect(screen.getByText("Cashier").closest("li")).toHaveTextContent(
      "Opens 3 of 5 pages, and can edit 1.",
    );
  });

  it("lets a role edit a page too, and closes a page it was open on", async () => {
    const { update } = draw();
    update.mockResolvedValue(matrix());
    await openPanel();
    chooseCashierPages();

    fireEvent.click(screen.getByRole("checkbox", { name: "Cashier can edit Inventory" }));
    // Closing a page takes its edit tick with it.
    fireEvent.click(screen.getByRole("checkbox", { name: "Cashier can open Sales" }));
    expect(screen.getByRole("checkbox", { name: "Cashier can edit Sales" })).not.toBeChecked();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith("cashier", level({ inventory: "full" })),
    );
  });

  it("puts a role back to the default, and cancel keeps what was saved", async () => {
    const { update } = draw(matrix(level({ reports: "full", sales: "full" })));
    await openPanel();
    chooseCashierPages();
    expect(screen.getByRole("checkbox", { name: "Cashier can open Reports" })).toBeChecked();

    fireEvent.click(screen.getByRole("button", { name: "Put back to the default" }));
    expect(screen.getByRole("checkbox", { name: "Cashier can open Reports" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Cashier can open Inventory" })).toBeChecked();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(update).not.toHaveBeenCalled();

    // Opening it again starts from what is saved, not from the abandoned changes.
    chooseCashierPages();
    expect(screen.getByRole("checkbox", { name: "Cashier can open Reports" })).toBeChecked();
  });

  it("says why when the server turns a change down", async () => {
    const { update } = draw();
    update.mockRejectedValue({
      response: { data: { detail: "That role can't be changed." } },
    });
    await openPanel();
    chooseCashierPages();
    fireEvent.click(screen.getByRole("checkbox", { name: "Cashier can open Reports" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That role can't be changed.");
    // Still open, with the tick kept, so it can be fixed or cancelled.
    expect(screen.getByRole("checkbox", { name: "Cashier can open Reports" })).toBeChecked();
  });

  it("names the other pages that go with a page", async () => {
    draw();
    await openPanel();
    chooseCashierPages();
    // From the sidebar: Collections and Cash count open with Sales.
    const sales = screen.getByRole("checkbox", { name: "Cashier can open Sales" }).closest("tr");
    expect(sales).toHaveTextContent("Also Collections, Cash count");
  });

  it("adds a role of the Boss's own, starting from a copy of another", async () => {
    draw();
    const created = matrix(cashierDefaults, [
      { ...keeper, name: "Front Desk", access: cashierDefaults },
    ]);
    vi.mocked(roleAccessService.createCustom).mockResolvedValue(created);
    await openPanel();
    expect(screen.getByText(/None yet/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add a role" }));
    const add = screen.getByRole("button", { name: "Add role" });
    // It needs a name.
    expect(add).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Role name"), { target: { value: "Front Desk" } });
    await chooseOption("Start from", "A copy of Cashier");
    expect(screen.getByRole("checkbox", { name: "Front Desk can open Sales" })).toBeChecked();
    fireEvent.click(screen.getByRole("checkbox", { name: "Front Desk can open Reports" }));

    fireEvent.click(add);
    await waitFor(() =>
      expect(roleAccessService.createCustom).toHaveBeenCalledWith(
        "Front Desk",
        level({ inventory: "view", sales: "full", reports: "view" }),
      ),
    );
    expect(await screen.findByText("Front Desk")).toBeInTheDocument();
  });

  it("renames a role of the Boss's own and changes its pages", async () => {
    draw(matrix(cashierDefaults, [keeper]));
    vi.mocked(roleAccessService.updateCustom).mockResolvedValue(
      matrix(cashierDefaults, [{ ...keeper, name: "Stockroom" }]),
    );
    await openPanel();
    fireEvent.click(screen.getByRole("button", { name: "Choose what Warehouse Manager can open" }));
    fireEvent.change(screen.getByLabelText("Role name"), { target: { value: "Stockroom" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Warehouse Manager can edit Inventory" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(roleAccessService.updateCustom).toHaveBeenCalledWith("r1", {
        name: "Stockroom",
        access: level({ inventory: "view", reports: "view" }),
      }),
    );
  });

  it("deletes a role nobody has, and not one that people still have", async () => {
    draw(matrix(cashierDefaults, [keeper, { ...keeper, id: "r2", name: "Driver", people: 2 }]));
    vi.mocked(roleAccessService.deleteCustom).mockResolvedValue(matrix(cashierDefaults, []));
    await openPanel();

    fireEvent.click(screen.getByRole("button", { name: "Choose what Driver can open" }));
    expect(screen.getByRole("button", { name: /Delete role/ })).toBeDisabled();
    expect(screen.getByText(/2 people have this role/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close what Driver can open" }));

    fireEvent.click(screen.getByRole("button", { name: "Choose what Warehouse Manager can open" }));
    fireEvent.click(screen.getByRole("button", { name: /Delete role/ }));
    await waitFor(() => expect(roleAccessService.deleteCustom).toHaveBeenCalledWith("r1"));
  });
});
