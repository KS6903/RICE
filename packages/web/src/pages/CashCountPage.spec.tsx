import { afterEach, describe, expect, it, vi } from "vitest";
import { configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { User } from "@rice-mill/shared";
import CashCountPage from "./CashCountPage";
import { useAuthStore } from "../stores/authStore";
import { cashService, type CashCount, type CashPage } from "../services/CashService";

configure({ asyncUtilTimeout: 5000 });

const owner: User = {
  id: "u1",
  username: "mill1",
  full_name: "Mill Owner",
  role: "owner",
  company_id: "c1",
};

const short: CashCount = {
  id: "k1",
  date: "2026-10-09",
  opening: 5000,
  cash_in: 12000,
  cash_out: 2000,
  expected: 15000,
  counted: 14500,
  taken_out: 0,
  difference: -500,
  note: "Paid the driver.",
  counted_by: "Tess Till",
  needs_review: true,
  reviewed_by: null,
  reviewed_at: null,
  review_note: null,
};

const page = (over: Partial<CashPage> = {}): CashPage => ({
  today: {
    date: "2026-10-10",
    opening: 5000,
    cash_received: [{ who: "Tess Till", amount: 12000 }],
    cash_in: 12000,
    expenses_entered: 1500,
  },
  tolerance: 100,
  manager: true,
  counts: [short],
  ...over,
});

const draw = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <CashCountPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe("CashCountPage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    useAuthStore.setState({ user: null });
  });

  it("works out what should be in the drawer and shows the difference as it's typed", async () => {
    useAuthStore.setState({ user: owner });
    vi.spyOn(cashService, "page").mockResolvedValue(page());
    const count = vi.spyOn(cashService, "count").mockResolvedValue(short);
    draw();
    const today = await screen.findByRole("region", { name: /Today/ });
    expect(within(today).getByText("₱17,000")).toBeInTheDocument(); // 5,000 + 12,000
    expect(within(today).getByText(/Expenses entered today: ₱1,500/)).toBeInTheDocument();
    fireEvent.change(within(today).getByLabelText("Paid out from the drawer"), {
      target: { value: "2,000" },
    });
    expect(within(today).getByText("₱15,000")).toBeInTheDocument();
    fireEvent.change(within(today).getByLabelText("Counted in the drawer"), {
      target: { value: "14500" },
    });
    expect(within(today).getByText(/Short by ₱500/)).toBeInTheDocument();
    fireEvent.click(within(today).getByRole("button", { name: "Save the count" }));
    await waitFor(() =>
      expect(count).toHaveBeenCalledWith({
        counted: "14500",
        cash_out: "2000",
        taken_out: "0",
        note: "",
      }),
    );
  });

  it("lets the owner review a difference with a note", async () => {
    useAuthStore.setState({ user: owner });
    vi.spyOn(cashService, "page").mockResolvedValue(page());
    const review = vi
      .spyOn(cashService, "review")
      .mockResolvedValue({ ...short, needs_review: false });
    draw();
    const day = await screen.findByRole("article", { name: /Oct/ });
    expect(within(day).getByText(/Short by ₱500/)).toBeInTheDocument();
    fireEvent.change(within(day).getByLabelText("What you found"), {
      target: { value: "Change given; receipt found." },
    });
    fireEvent.click(within(day).getByRole("button", { name: "Mark reviewed" }));
    await waitFor(() => expect(review).toHaveBeenCalledWith("k1", "Change given; receipt found."));
  });

  it("tells a cashier the review is the owner's", async () => {
    useAuthStore.setState({ user: { ...owner, role: "cashier" } });
    vi.spyOn(cashService, "page").mockResolvedValue(page({ manager: false }));
    draw();
    const day = await screen.findByRole("article", { name: /Oct/ });
    expect(within(day).getByText("Waiting for the owner to review.")).toBeInTheDocument();
    expect(within(day).queryByRole("button", { name: "Mark reviewed" })).toBeNull();
  });
});
