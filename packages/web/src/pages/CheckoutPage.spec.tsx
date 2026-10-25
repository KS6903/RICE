import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { SubscriptionPlan, User } from "@rice-mill/shared";
import CheckoutPage from "./CheckoutPage";
import { useAuthStore } from "../stores/authStore";
import { billingService } from "../services/BillingService";
import type { PaymentMethod } from "../utils/paymentMethods";

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

const basic: SubscriptionPlan = {
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

const gcash: PaymentMethod = {
  id: "gcash",
  label: "GCash",
  provider: "GCash",
  accountName: "Oraiza Test",
  accountNumber: "0917 000 0000",
  referenceHint: "The reference number on your GCash receipt",
};
const notYet: PaymentMethod = { ...gcash, accountName: "", accountNumber: "" };

const draw = (methods: PaymentMethod[], entry = "/settings/checkout?plan=basic&interval=monthly") =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[entry]}>
        <CheckoutPage methods={methods} />
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe("Checkout", () => {
  beforeEach(() => {
    useAuthStore.setState({ user: owner });
    vi.spyOn(billingService, "getPlans").mockResolvedValue([basic]);
    vi.spyOn(billingService, "getMyRequest").mockResolvedValue({ request: null });
    vi.spyOn(billingService, "createUpgradeRequest").mockResolvedValue({});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useAuthStore.setState({ user: null });
  });

  it("shows the account to pay and needs a reference before sending", async () => {
    draw([gcash]);
    expect(await screen.findByText("0917 000 0000")).toBeInTheDocument();
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
        note: "Paid by GCash, reference 1234567890123",
      }),
    );
    expect(await screen.findByText("Request sent")).toBeInTheDocument();
  });

  it("carries the interval over and can switch it", async () => {
    draw([gcash], "/settings/checkout?plan=basic&interval=annual");
    expect(await screen.findByText("Save 17% vs monthly")).toBeInTheDocument();
    expect(screen.getByText("/yr")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Monthly" }));
    expect(screen.getByText("/mo")).toBeInTheDocument();
    expect(screen.queryByText("Save 17% vs monthly")).not.toBeInTheDocument();
  });

  it("still sends the request while no payment details are published", async () => {
    draw([notYet]);
    expect(await screen.findByText(/Payment details are coming soon/)).toBeInTheDocument();
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
    draw([gcash]);
    expect(await screen.findByText("You already have a request waiting")).toBeInTheDocument();
    expect(screen.queryByLabelText("Payment reference")).not.toBeInTheDocument();
  });
});
