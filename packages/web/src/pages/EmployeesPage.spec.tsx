import { afterEach, describe, expect, it, vi } from "vitest";
import { configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { User } from "@rice-mill/shared";
import EmployeesPage from "./EmployeesPage";
import { useAuthStore } from "../stores/authStore";
import { employeesService } from "../services/EmployeesService";
import { inventoryService } from "../services/InventoryService";
import { chooseOption } from "../test/pickers";

configure({ asyncUtilTimeout: 5000 });

const owner: User = {
  id: "u1",
  username: "mill1",
  full_name: "Mill Owner",
  role: "owner",
  company_id: "c1",
  features: ["*"],
};

const NUMBERS: Record<string, string> = { regular: "REG-0003", contractual: "CON-0001" };

function setup() {
  useAuthStore.setState({ user: owner });
  vi.spyOn(employeesService, "list").mockResolvedValue([]);
  vi.spyOn(inventoryService, "getBranches").mockResolvedValue([]);
  vi.spyOn(employeesService, "nextNumber").mockImplementation((type) =>
    Promise.resolve({ employee_no: NUMBERS[type] ?? "EMP-0001" }),
  );
  const create = vi.spyOn(employeesService, "create").mockResolvedValue({ id: "e1" });
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <EmployeesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: /Add employee/ }));
  return { create };
}

const optionsOf = (label: string) => {
  fireEvent.click(screen.getByLabelText(label));
  const names = screen.getAllByRole("option").map((o) => o.textContent);
  fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
  return names;
};

describe("Add employee", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    useAuthStore.setState({ user: null });
  });

  it("sets the employee number from the employment type", async () => {
    setup();
    const number = screen.getByLabelText("Employee #");
    expect(number).toHaveAttribute("readonly");
    await waitFor(() => expect(number).toHaveValue("REG-0003"));

    await chooseOption("Employment type", "Contractual");
    await waitFor(() => expect(number).toHaveValue("CON-0001"));
  });

  it("calls the pay a rate, and works the monthly salary out from it", async () => {
    setup();
    const rate = screen.getByLabelText("Rate (₱)");
    const monthly = screen.getByLabelText("Monthly salary (₱)");
    expect(monthly).toHaveAttribute("readonly");
    expect(screen.queryByText(/Daily rate/)).toBeNull();

    // Regular pay is a day's rate: 26 working days.
    fireEvent.change(rate, { target: { value: "500" } });
    expect(monthly).toHaveValue("13000");
    expect(screen.getByText("Paid per day.")).toBeInTheDocument();

    await chooseOption("Employment type", "Monthly");
    expect(monthly).toHaveValue("500");
    expect(screen.getByText("Paid per month.")).toBeInTheDocument();

    await chooseOption("Employment type", "Hourly");
    fireEvent.change(rate, { target: { value: "70" } });
    expect(monthly).toHaveValue("14560");

    await chooseOption("Employment type", "Piece-rate");
    expect(monthly).toHaveValue("");
    expect(screen.getByText(/no fixed monthly figure/)).toBeInTheDocument();
  });

  it("asks for what a bank transfer needs before it will save", async () => {
    const { create } = setup();
    fireEvent.change(screen.getByLabelText("First name *"), { target: { value: "Ana" } });
    fireEvent.change(screen.getByLabelText("Last name *"), { target: { value: "Reyes" } });
    const save = screen.getByRole("button", { name: "Save employee" });
    expect(save).toBeEnabled();

    // Cash needs nothing more.
    expect(screen.queryByLabelText("Account number *")).toBeNull();

    await chooseOption("Paid by", "Bank transfer");
    expect(save).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Bank name"), { target: { value: "BDO Unibank" } });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Account number *"), {
      target: { value: "0012 3456 7890" },
    });
    expect(save).toBeEnabled();

    fireEvent.click(save);
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          first_name: "Ana",
          pay_method: "bank_transfer",
          pay_provider: "BDO Unibank",
          pay_account_no: "0012 3456 7890",
        }),
      ),
    );
  });

  it("offers the other ways of paying with their own details", async () => {
    setup();
    await chooseOption("Paid by", "E-wallet (GCash, Maya)");
    expect(screen.getByLabelText("E-wallet provider")).toBeInTheDocument();
    expect(screen.getByLabelText("Mobile number *")).toBeInTheDocument();

    await chooseOption("Paid by", "Check");
    expect(screen.getByLabelText("Payee name")).toBeInTheDocument();
    expect(screen.queryByLabelText("Mobile number *")).toBeNull();

    await chooseOption("Paid by", "Payroll ATM card");
    expect(screen.getByLabelText("Bank or card issuer")).toBeInTheDocument();
    expect(screen.getByLabelText("Card or account number *")).toBeInTheDocument();
  });

  it("keeps the details of one way of paying from carrying over to the next", async () => {
    setup();
    await chooseOption("Paid by", "Bank transfer");
    fireEvent.change(screen.getByLabelText("Account number *"), { target: { value: "123456" } });
    await chooseOption("Paid by", "E-wallet (GCash, Maya)");
    expect(screen.getByLabelText("Mobile number *")).toHaveValue("");
  });

  it("lists every dropdown alphabetically", () => {
    setup();
    for (const label of [
      "Position",
      "Department",
      "Relation",
      "Paid by",
      "Gender",
      "Civil status",
    ]) {
      const names = optionsOf(label);
      const body = names.filter((n) => n !== "Other" && n !== "Not set");
      expect(body, label).toEqual([...body].sort((a, b) => (a ?? "").localeCompare(b ?? "")));
    }
    // "Other" is last, after the rest.
    for (const label of ["Position", "Relation"]) {
      const names = optionsOf(label);
      expect(names[names.length - 1], label).toBe("Other");
    }
  });

  it("puts probationary and contractual last among the employment types", () => {
    setup();
    const names = optionsOf("Employment type");
    expect(names.slice(-2)).toEqual(["Probationary", "Contractual"]);
    expect(names).toContain("Commission-based");
    expect(names).toContain("Piece-rate");
    const rest = names.slice(0, -2);
    expect(rest).toEqual([...rest].sort((a, b) => (a ?? "").localeCompare(b ?? "")));
  });

  it("offers a job position, a department and a relation to choose from", async () => {
    setup();
    await chooseOption("Position", "Mill Operator");
    await chooseOption("Department", "Drying");
    await chooseOption("Relation", "Spouse");
    expect(within(document.body).getByLabelText("Position")).toHaveTextContent("Mill Operator");
    expect(screen.getByLabelText("Department")).toHaveTextContent("Drying");
    expect(screen.getByLabelText("Relation")).toHaveTextContent("Spouse");
  });
});
