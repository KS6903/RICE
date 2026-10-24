import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { User } from "@rice-mill/shared";
import CatalogPage from "./CatalogPage";
import { useAuthStore } from "../stores/authStore";

// The lists themselves have their own tests; here, which ones a mill gets.
vi.mock("../components/catalog/CatalogLists", () => ({
  VarietiesList: () => <p>the varieties list</p>,
  ByproductsList: () => <p>the by-products list</p>,
  ExpenseCategoriesList: () => <p>the categories list</p>,
  MachinesList: () => <p>the machines list</p>,
}));
vi.mock("../components/catalog/ServiceIntervalsList", () => ({
  ServiceIntervalsList: () => <p>the service intervals</p>,
}));
vi.mock("./DispatchPage", () => ({
  TrucksPanel: () => <p>the trucks</p>,
  DriversPanel: () => <p>the drivers</p>,
}));
vi.mock("./FieldOperatorsPage", () => ({ FieldOperatorsContent: () => <p>the operators</p> }));
vi.mock("./EmployeesPage", () => ({ default: () => <p>the employees</p> }));

const FREE = ["dashboard", "paddy", "inventory", "sales", "expenses", "users"];

const boss = (features: string[]): User =>
  ({
    id: "u1",
    username: "mill1",
    full_name: "Mill Boss",
    role: "owner",
    company_id: "c1",
    features,
  }) as User;

const draw = () =>
  render(
    <MemoryRouter>
      <CatalogPage />
    </MemoryRouter>,
  );

describe("CatalogPage", () => {
  afterEach(() => useAuthStore.setState({ user: null }));

  it("gives a Free mill its own lists, and the rest under other plans", () => {
    useAuthStore.setState({ user: boss(FREE) });
    draw();
    expect(screen.getByRole("tab", { name: "Rice varieties" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("the varieties list")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "By-products" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Expense categories" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Machines" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "More with other plans" }));
    const others = screen.getByTestId("catalog-other-plans");
    expect(others.querySelector("[data-plan=Basic]")).toHaveTextContent("Machines");
    expect(others.querySelector("[data-plan=Basic]")).toHaveTextContent("Trucks & drivers");
    expect(others.querySelector("[data-plan=Pro]")).toHaveTextContent("Employees");
    expect(others.querySelector("[data-plan=Enterprise]")).toHaveTextContent("Service intervals");
  });

  it("an Enterprise mill gets every list, one tab each", () => {
    useAuthStore.setState({ user: boss(["*"]) });
    draw();
    expect(screen.getAllByRole("tab")).toHaveLength(8);
    expect(screen.queryByTestId("catalog-other-plans")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Trucks & drivers" }));
    expect(screen.getByText("the trucks")).toBeInTheDocument();
    expect(screen.getByText("the drivers")).toBeInTheDocument();
  });

  it("someone who can't edit any of the lists is told so", () => {
    useAuthStore.setState({ user: { ...boss(FREE), role: "cashier" } });
    draw();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(screen.getByText(/Your role can't change any of these lists/)).toBeInTheDocument();
  });
});
