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

type SetupOptions = {
  /** Click "Add employee" (the default); false leaves the page as it loads. */
  openForm?: boolean;
  employees?: any[];
  nextNumber?: (employmentType: string) => Promise<{ employee_no: string }>;
};

function setup({
  openForm = true,
  employees = [],
  nextNumber = (type) => Promise.resolve({ employee_no: NUMBERS[type] ?? "EMP-0001" }),
}: SetupOptions = {}) {
  useAuthStore.setState({ user: owner });
  vi.spyOn(employeesService, "list").mockResolvedValue(employees);
  vi.spyOn(inventoryService, "getBranches").mockResolvedValue([]);
  vi.spyOn(employeesService, "nextNumber").mockImplementation(nextNumber);
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
  if (openForm) fireEvent.click(screen.getByRole("button", { name: /Add employee/ }));
  return { create };
}

/** Fills the two required names, so Save is only held back by what a test is about. */
function fillNames() {
  fireEvent.change(screen.getByLabelText("First name *"), { target: { value: "Ana" } });
  fireEvent.change(screen.getByLabelText("Last name *"), { target: { value: "Reyes" } });
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

  it("previews the number as soon as the form opens, and says so while it works it out", async () => {
    setup({ nextNumber: () => new Promise(() => {}) });
    const number = screen.getByLabelText("Employee #");
    expect(number).toHaveValue("");
    expect(number).toHaveAttribute("placeholder", "Working it out…");
    expect(screen.getByText("Preview, set from the employment type.")).toBeInTheDocument();
  });

  it("still lets the employee be saved when the preview can't be loaded", async () => {
    const { create } = setup({ nextNumber: () => Promise.reject(new Error("no route")) });
    fillNames();
    await screen.findByText(/Couldn't load the preview/);
    const number = screen.getByLabelText("Employee #");
    expect(number).toHaveValue("");
    expect(number).toHaveAttribute("placeholder", "Set when saved");

    fireEvent.click(screen.getByRole("button", { name: "Save employee" }));
    await waitFor(() => expect(create).toHaveBeenCalled());
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
    // An e-wallet asks for an account number, not a mobile number.
    expect(screen.getByLabelText("Account number *")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Mobile number/)).toBeNull();

    await chooseOption("Paid by", "Check");
    expect(screen.getByLabelText("Payee name")).toBeInTheDocument();
    expect(screen.queryByLabelText("Account number *")).toBeNull();

    await chooseOption("Paid by", "Payroll ATM card");
    expect(screen.getByLabelText("Bank or card issuer")).toBeInTheDocument();
    expect(screen.getByLabelText("Card or account number *")).toBeInTheDocument();
  });

  it("keeps the details of one way of paying from carrying over to the next", async () => {
    setup();
    await chooseOption("Paid by", "Bank transfer");
    fireEvent.change(screen.getByLabelText("Account number *"), { target: { value: "123456" } });
    await chooseOption("Paid by", "E-wallet (GCash, Maya)");
    expect(screen.getByLabelText("Account number *")).toHaveValue("");
  });

  it("suggests banks of every kind, and e-wallets by the name they go by", async () => {
    setup();
    // Read straight from the DOM: a role query is slow on a form this big.
    const suggestions = () =>
      Array.from(document.querySelectorAll('[role="option"]')).map((o) => o.textContent);

    await chooseOption("Paid by", "Bank transfer");
    const bank = screen.getByLabelText("Bank name");
    for (const [typed, suggested] of [
      ["bpi", "BPI (Bank of the Philippine Islands)"],
      ["psbank", "PSBank (Philippine Savings Bank)"],
      ["tonik", "Tonik Digital Bank"],
      ["guinobatan", "Rural Bank of Guinobatan"],
      ["cooperative bank of ce", "Cooperative Bank of Cebu"],
    ]) {
      fireEvent.change(bank, { target: { value: typed } });
      expect(suggestions(), typed).toContain(suggested);
    }
    // The open suggestions are a listbox too, which chooseOption would mistake
    // for the menu it is after.
    fireEvent.blur(bank);

    await chooseOption("Paid by", "E-wallet (GCash, Maya)");
    const wallet = screen.getByLabelText("E-wallet provider");
    fireEvent.change(wallet, { target: { value: "g" } });
    expect(suggestions()).toEqual(expect.arrayContaining(["GCash", "GrabPay"]));
    // Banks are not offered as e-wallets.
    fireEvent.change(wallet, { target: { value: "bpi" } });
    expect(suggestions()).toEqual([]);
  });

  it("keeps Other in Position when nothing is typed beside it", async () => {
    const { create } = setup();
    fillNames();
    expect(screen.queryByLabelText("Specify the position (optional)")).toBeNull();

    await chooseOption("Position", "Other");
    expect(screen.getByLabelText("Specify the position (optional)")).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "Save employee" }));
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(expect.objectContaining({ position: "Other" })),
    );
  });

  it("saves what was typed beside Other as the position", async () => {
    const { create } = setup();
    fillNames();
    await chooseOption("Position", "Other");
    fireEvent.change(screen.getByLabelText("Specify the position (optional)"), {
      target: { value: "  Forklift Operator " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save employee" }));
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ position: "Forklift Operator" }),
      ),
    );
  });

  it("drops the typed position when another one is chosen", async () => {
    const { create } = setup();
    fillNames();
    await chooseOption("Position", "Other");
    fireEvent.change(screen.getByLabelText("Specify the position (optional)"), {
      target: { value: "Forklift Operator" },
    });
    await chooseOption("Position", "Driver");
    expect(screen.queryByLabelText("Specify the position (optional)")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save employee" }));
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(expect.objectContaining({ position: "Driver" })),
    );

    // Choosing Other again starts with the box empty.
    await waitFor(() => expect(screen.queryByLabelText("First name *")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: /Add employee/ }));
    await chooseOption("Position", "Other");
    expect(screen.getByLabelText("Specify the position (optional)")).toHaveValue("");
  });

  it("reads a position that isn't on the list as Other, with its text beside it", async () => {
    const employee = {
      id: "e1",
      full_name: "Ana Reyes",
      first_name: "Ana",
      last_name: "Reyes",
      position: "Forklift Operator",
      is_active: true,
    };
    const update = vi
      .spyOn(employeesService, "update")
      .mockResolvedValue({ ...employee, position: "Crane Operator" });
    setup({ openForm: false, employees: [employee] });

    fireEvent.click(await screen.findByText("Ana Reyes"));
    fireEvent.click(await screen.findByRole("button", { name: /Edit/ }));
    expect(screen.getByLabelText("Position")).toHaveTextContent("Other");
    const box = screen.getByLabelText("Specify the position (optional)");
    expect(box).toHaveValue("Forklift Operator");

    fireEvent.change(box, { target: { value: "Crane Operator" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith(
        "e1",
        expect.objectContaining({ position: "Crane Operator" }),
      ),
    );
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

  it("puts regular first, and probationary and contractual last, among the employment types", () => {
    setup();
    const names = optionsOf("Employment type");
    expect(names[0]).toBe("Regular");
    expect(names.slice(-2)).toEqual(["Probationary", "Contractual"]);
    expect(names).toContain("Commission-based");
    expect(names).toContain("Piece-rate");
    const rest = names.slice(1, -2);
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
