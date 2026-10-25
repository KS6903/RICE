import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { SubscriptionPlan, User } from "@rice-mill/shared";
import CheckoutPage from "./CheckoutPage";
import { useAuthStore } from "../stores/authStore";
import { billingService } from "../services/BillingService";
import { redirectTo } from "../utils/redirect";

vi.mock("../utils/redirect", () => ({ redirectTo: vi.fn() }));

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

const unpaid: SubscriptionPlan = {
  id: "basic",
  code: "basic",
  name: "Basic",
  description: null,
  monthly_price: 999,
  annual_price: 9990,
  max_users: 5,
  max_branches: 1,
  features: ["paddy", "milling"],
  is_active: true,
  sort_order: 1,
};
const basic: SubscriptionPlan = {
  ...unpaid,
  payment_bank: "Test Bank",
  payment_account_name: "Oraiza Test",
  payment_account_number: "0000 1111 2222",
};

const draw = (entry = "/settings/checkout?plan=basic&interval=monthly") =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[entry]}>
        <CheckoutPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe("Checkout", () => {
  beforeEach(() => {
    useAuthStore.setState({ user: owner });
    vi.spyOn(billingService, "getPlans").mockResolvedValue([basic]);
    vi.spyOn(billingService, "getMyRequest").mockResolvedValue({ request: null });
    vi.spyOn(billingService, "createUpgradeRequest").mockResolvedValue({});
    vi.spyOn(billingService, "getPaymentOptions").mockResolvedValue({
      paymongo: false,
      paypal: false,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useAuthStore.setState({ user: null });
  });

  it("shows the account to pay and needs a reference before sending", async () => {
    draw();
    expect(await screen.findByText("0000 1111 2222")).toBeInTheDocument();
    expect(screen.getByText("Test Bank")).toBeInTheDocument();
    expect(screen.getByText("Oraiza Test")).toBeInTheDocument();
    const send = screen.getByRole("button", { name: "I've paid, send for confirmation" });
    expect(send).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Payment reference"), {
      target: { value: "1234567890123" },
    });
    fireEvent.click(send);

    await waitFor(() =>
      expect(billingService.createUpgradeRequest).toHaveBeenCalledWith({
        plan_id: "basic",
        request_type: "upgrade",
        billing_interval: "monthly",
        note: "Paid to Test Bank, reference 1234567890123",
      }),
    );
    expect(await screen.findByText("Request sent")).toBeInTheDocument();
  });

  it("carries the interval over and can switch it", async () => {
    draw("/settings/checkout?plan=basic&interval=annual");
    expect(await screen.findByText("Save 17% vs monthly")).toBeInTheDocument();
    expect(screen.getByText("/yr")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Monthly" }));
    expect(screen.getByText("/mo")).toBeInTheDocument();
    expect(screen.queryByText("Save 17% vs monthly")).not.toBeInTheDocument();
  });

  it("still sends the request while the plan has no payment account", async () => {
    vi.spyOn(billingService, "getPlans").mockResolvedValue([unpaid]);
    draw();
    expect(
      await screen.findByText(/Payment details for Basic are coming soon/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));

    await waitFor(() =>
      expect(billingService.createUpgradeRequest).toHaveBeenCalledWith(
        expect.objectContaining({ plan_id: "basic", note: undefined }),
      ),
    );
  });

  it("stops at a request that is already waiting", async () => {
    vi.spyOn(billingService, "getMyRequest").mockResolvedValue({
      request: { id: "r1", status: "pending", requested_plan_name: "Pro" },
    });
    draw();
    expect(await screen.findByText("You already have a request waiting")).toBeInTheDocument();
    expect(screen.queryByLabelText("Payment reference")).not.toBeInTheDocument();
  });

  it("pays online through PayMongo, or PayPal in dollars", async () => {
    vi.spyOn(billingService, "getPaymentOptions").mockResolvedValue({
      paymongo: true,
      paypal: true,
    });
    vi.spyOn(billingService, "getPlans").mockResolvedValue([
      { ...basic, monthly_price_usd: 20, annual_price_usd: 200 },
    ]);
    vi.spyOn(billingService, "startCheckout").mockResolvedValue({
      payment_id: "pay1",
      checkout_url: "https://checkout.paymongo.com/cs_1",
    });
    draw();

    expect(await screen.findByText("Or pay by bank transfer")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Pay \$20 USD/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Pay ₱999/ }));

    await waitFor(() =>
      expect(billingService.startCheckout).toHaveBeenCalledWith({
        plan_id: "basic",
        billing_interval: "monthly",
        provider: "paymongo",
      }),
    );
    await waitFor(() =>
      expect(redirectTo).toHaveBeenCalledWith("https://checkout.paymongo.com/cs_1"),
    );
  });

  it("leaves PayPal out for a plan with no dollar price", async () => {
    vi.spyOn(billingService, "getPaymentOptions").mockResolvedValue({
      paymongo: true,
      paypal: true,
    });
    draw();
    expect(await screen.findByRole("button", { name: /Pay ₱999/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /USD/ })).not.toBeInTheDocument();
  });

  it("says so when the payment was cancelled", async () => {
    draw("/settings/checkout?plan=basic&interval=monthly&cancelled=1");
    expect(await screen.findByText(/The payment was cancelled/)).toBeInTheDocument();
  });
});
