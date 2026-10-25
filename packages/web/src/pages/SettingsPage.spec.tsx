import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { SubscriptionPlan, User } from "@rice-mill/shared";
import SettingsPage from "./SettingsPage";
import { useAuthStore } from "../stores/authStore";
import { billingService } from "../services/BillingService";

const owner: User = {
  id: "u1",
  username: "mill2",
  full_name: "Mill Owner",
  role: "owner",
  company_id: "c1",
  features: [],
  subscription: {
    code: "free",
    name: "Free",
    monthly_price: 0,
    max_users: 3,
    max_branches: 1,
    status: "active",
    expires_at: null,
  },
};

const plan = (over: Partial<SubscriptionPlan>): SubscriptionPlan => ({
  id: over.code ?? "p",
  code: "p",
  name: "P",
  description: null,
  monthly_price: 0,
  annual_price: 0,
  max_users: null,
  max_branches: null,
  features: [],
  is_active: true,
  sort_order: 0,
  ...over,
});

function Checkout() {
  const { search } = useLocation();
  return <p>checkout{search}</p>;
}

const draw = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={["/settings"]}>
        <Routes>
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/settings/checkout" element={<Checkout />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe("Billing tab: monthly / annual switch", () => {
  beforeEach(() => {
    useAuthStore.setState({ user: owner });
    vi.spyOn(billingService, "getPlans").mockResolvedValue([
      plan({ code: "free", name: "Free" }),
      plan({ code: "basic", name: "Basic", monthly_price: 999, annual_price: 9990 }),
      // No annual price set by the admin: billed as 12 months.
      plan({ code: "custom", name: "Custom", monthly_price: 500 }),
    ]);
    vi.spyOn(billingService, "getMyRequest").mockResolvedValue({ request: null });
    vi.spyOn(billingService, "createUpgradeRequest").mockResolvedValue({});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useAuthStore.setState({ user: null });
  });

  it("shows monthly prices by default", async () => {
    draw();
    expect(await screen.findByText(/₱999$/)).toBeInTheDocument();
    expect(screen.getAllByText("/mo")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Monthly" })).toHaveAttribute("aria-pressed", "true");
  });

  it("switches every card to annual prices", async () => {
    draw();
    await screen.findByText(/₱999$/);
    fireEvent.click(screen.getByRole("button", { name: "Annual" }));

    expect(screen.getByRole("button", { name: "Annual" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/₱9[,.\s]?990$/)).toBeInTheDocument();
    expect(screen.getByText("Save 17% vs monthly")).toBeInTheDocument();
    expect(screen.getByText(/₱6[,.\s]?000$/)).toBeInTheDocument();
    expect(screen.getAllByText("/yr")).toHaveLength(2);
    expect(screen.queryByText("/mo")).not.toBeInTheDocument();
    expect(screen.queryByText("₱0")).not.toBeInTheDocument();
  });

  it("opens checkout for the plan and interval picked", async () => {
    draw();
    await screen.findByText(/₱999$/);
    fireEvent.click(screen.getByRole("button", { name: "Annual" }));
    fireEvent.click(screen.getByRole("button", { name: "Get Basic" }));

    expect(await screen.findByText("checkout?plan=basic&interval=annual")).toBeInTheDocument();
    // Nothing is asked for until the plan is paid for.
    expect(billingService.createUpgradeRequest).not.toHaveBeenCalled();
  });
});
