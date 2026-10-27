import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { User } from "@rice-mill/shared";
import Sidebar from "./Sidebar";
import { useAuthStore } from "../../stores/authStore";

const FREE = ["dashboard", "paddy", "inventory", "sales", "expenses", "users"];

const owner = (features: string[]): User =>
  ({
    id: "u1",
    username: "mill2",
    full_name: "Mill Boss",
    role: "owner",
    company_id: "c1",
    features,
    subscription: { code: "free", name: "Free", status: "active" },
  }) as User;

const draw = () =>
  render(
    <MemoryRouter>
      <Sidebar open={false} onClose={() => {}} />
    </MemoryRouter>,
  );

const menu = () => screen.getByRole("navigation");

describe("Sidebar", () => {
  beforeEach(() => localStorage.clear());

  it("keeps the pages on the mill's plan together, in their groups", () => {
    useAuthStore.setState({ user: owner(FREE) });
    draw();
    for (const page of ["Dashboard", "Paddy / Palay", "Inventory", "Sales", "Expenses", "Users"]) {
      expect(within(menu()).getByRole("link", { name: page })).toBeInTheDocument();
    }
    for (const heading of ["Buy & mill", "Stock", "Sell", "Money", "Team"]) {
      expect(within(menu()).getByText(heading)).toBeInTheDocument();
    }
    // Pages from other plans aren't mixed in, and nothing shows a lock.
    expect(within(menu()).queryByRole("link", { name: "Milling" })).not.toBeInTheDocument();
    expect(within(menu()).queryByRole("link", { name: /Automations/ })).not.toBeInTheDocument();
  });

  it("lists other plans' pages in one closed line, by plan, leading to the plans", () => {
    useAuthStore.setState({ user: owner(FREE) });
    draw();
    const toggle = screen.getByRole("button", { name: "More with other plans" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const other = screen.getByTestId("nav-other-plans");
    const basic = other.querySelector("[data-plan=Basic]") as HTMLElement;
    const pro = other.querySelector("[data-plan=Pro]") as HTMLElement;
    const enterprise = other.querySelector("[data-plan=Enterprise]") as HTMLElement;
    expect(within(basic).getByRole("link", { name: "Milling" })).toHaveAttribute(
      "href",
      "/settings",
    );
    expect(within(basic).getByRole("link", { name: "Dispatch" })).toBeInTheDocument();
    expect(within(pro).getByRole("link", { name: "Field Operators" })).toBeInTheDocument();
    expect(within(pro).getByRole("link", { name: "Cash count" })).toBeInTheDocument();
    // Selling a plan, nothing in it is marked Beta.
    expect(within(enterprise).getByRole("link", { name: "Automations" })).toBeInTheDocument();
  });

  it("remembers the line open for that person", () => {
    useAuthStore.setState({ user: owner(FREE) });
    const first = draw();
    fireEvent.click(screen.getByRole("button", { name: "More with other plans" }));
    first.unmount();
    draw();
    expect(screen.getByRole("button", { name: "More with other plans" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("staff, who can't change the plan, don't see other plans' pages", () => {
    useAuthStore.setState({ user: { ...owner(FREE), role: "cashier" } });
    draw();
    expect(screen.queryByTestId("nav-other-plans")).not.toBeInTheDocument();
    expect(within(menu()).getByRole("link", { name: "Sales" })).toBeInTheDocument();
  });

  it("a mill with every page has no such line", () => {
    useAuthStore.setState({ user: owner(["*"]) });
    draw();
    expect(screen.queryByTestId("nav-other-plans")).not.toBeInTheDocument();
    expect(within(menu()).getByRole("link", { name: "Milling" })).toBeInTheDocument();
  });
});
