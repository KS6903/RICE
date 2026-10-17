import { afterEach, describe, expect, it, vi } from "vitest";
import { configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import RoleAccessPanel from "./RoleAccessPanel";
import {
  roleAccessService,
  type AccessLevel,
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

const matrix = (cashier: Record<string, AccessLevel> = cashierDefaults): RoleAccessData => ({
  sections: SECTIONS,
  locked_sections: ["dashboard", "tasks", "settings", "users"],
  roles: [
    { role: "owner", editable: false, access: everything, defaults: everything },
    { role: "admin", editable: false, access: everything, defaults: everything },
    { role: "cashier", editable: true, access: cashier, defaults: cashierDefaults },
  ],
});

function draw(data: RoleAccessData = matrix()) {
  const get = vi.spyOn(roleAccessService, "get").mockResolvedValue(data);
  const update = vi.spyOn(roleAccessService, "update");
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

  it("shows each role, with the Boss and Admin fixed at everything", async () => {
    draw();
    await openPanel();
    const boss = screen.getByText("Boss").closest("li") as HTMLElement;
    expect(within(boss).getByText("Full access")).toBeInTheDocument();
    expect(within(boss).queryByRole("button", { name: /Choose/ })).toBeNull();
    expect(screen.getByText("Admin").closest("li")).toHaveTextContent("Full access");

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
      response: { data: { detail: "The users page can't be changed here." } },
    });
    await openPanel();
    chooseCashierPages();
    fireEvent.click(screen.getByRole("checkbox", { name: "Cashier can open Reports" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The users page can't be changed here.",
    );
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
});
