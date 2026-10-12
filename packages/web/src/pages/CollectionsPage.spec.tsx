import { afterEach, describe, expect, it, vi } from "vitest";
import { configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { User } from "@rice-mill/shared";
import CollectionsPage from "./CollectionsPage";
import { useAuthStore } from "../stores/authStore";
import { collectionsService, type Debtor } from "../services/CollectionsService";
import { chooseDate } from "../test/pickers";

configure({ asyncUtilTimeout: 5000 });

const nena: Debtor = {
  customer: { id: "c1", name: "Aling Nena Store", phone: "0917 555 0101" },
  overdue: 8000,
  due_soon: 0,
  oldest_days_late: 10,
  last_paid: "2026-09-01",
  promise: "broken",
  last_follow_up: "Promised to pay ₱5,000 by Sat 26 Sep",
  last_follow_up_at: "2026-09-22T00:00:00Z",
  invoices: [{ invoice_no: "INV-1", balance: 8000, due: "2026-09-18", days_late: 10 }],
  reminder: "Good day Nena. This is Test Mill. We were expecting your payment.",
};

const cora: Debtor = {
  ...nena,
  customer: { id: "c2", name: "Cora Wholesale", phone: null },
  overdue: 90000,
  promise: "waiting",
  last_follow_up: "Promised to pay by Fri 02 Oct",
  reminder: "Good day Cora.",
};

const owner: User = {
  id: "u1",
  username: "mill1",
  full_name: "Mill Owner",
  role: "owner",
  company_id: "c1",
};

const draw = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <CollectionsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe("CollectionsPage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    useAuthStore.setState({ user: null });
  });

  it("walks through the four steps for the first customer, and records a promise", async () => {
    useAuthStore.setState({ user: owner });
    vi.spyOn(collectionsService, "list").mockResolvedValue({
      today: "2026-09-28",
      overdue_total: 98000,
      customers: [nena, cora],
    });
    vi.spyOn(collectionsService, "history").mockResolvedValue({ follow_ups: [] });
    const record = vi
      .spyOn(collectionsService, "record")
      .mockResolvedValue({ id: "f1", summary: "Promised to pay" });
    draw();

    const who = await screen.findByRole("region", { name: "Who to call first" });
    expect(within(who).getByText("Promise not kept")).toBeInTheDocument();
    expect(within(who).getByText("Promised to pay by Fri 02 Oct")).toBeInTheDocument();

    const detail = screen.getByLabelText("Collecting from Aling Nena Store");
    expect(within(detail).getByText("INV-1")).toBeInTheDocument();
    expect(within(detail).getByLabelText("Reminder message")).toHaveValue(nena.reminder);
    expect(within(detail).getByRole("link", { name: /Open in Messages/ })).toHaveAttribute(
      "href",
      `sms:09175550101?body=${encodeURIComponent(nena.reminder)}`,
    );

    chooseDate("Pay by", "2026-10-02", within(detail));
    fireEvent.change(within(detail).getByLabelText(/How much/), { target: { value: "5,000" } });
    fireEvent.click(within(detail).getByRole("button", { name: "Save what happened" }));
    await waitFor(() =>
      expect(record).toHaveBeenCalledWith("c1", {
        outcome: "promised",
        promised_date: "2026-10-02",
        promised_amount: 5000,
        note: "",
      }),
    );

    // Picking another customer opens theirs.
    fireEvent.click(within(who).getByRole("button", { name: /Cora Wholesale/ }));
    expect(await screen.findByLabelText("Collecting from Cora Wholesale")).toBeInTheDocument();
  });

  it("is read-only for someone without sales write access", async () => {
    useAuthStore.setState({ user: { ...owner, role: "mill_operator" } });
    vi.spyOn(collectionsService, "list").mockResolvedValue({
      today: "2026-09-28",
      overdue_total: 8000,
      customers: [nena],
    });
    vi.spyOn(collectionsService, "history").mockResolvedValue({ follow_ups: [] });
    draw();
    await screen.findByLabelText("Collecting from Aling Nena Store");
    expect(screen.queryByRole("button", { name: "Save what happened" })).toBeNull();
  });

  it("says so when nobody owes anything", async () => {
    useAuthStore.setState({ user: owner });
    vi.spyOn(collectionsService, "list").mockResolvedValue({
      today: "2026-09-28",
      overdue_total: 0,
      customers: [],
    });
    draw();
    expect(await screen.findByText("Nobody owes you anything overdue.")).toBeInTheDocument();
  });
});
