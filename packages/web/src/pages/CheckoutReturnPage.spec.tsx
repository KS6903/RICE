import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import CheckoutReturnPage from "./CheckoutReturnPage";
import { billingService } from "../services/BillingService";

const payment = {
  id: "pay1",
  plan_id: "basic",
  plan_name: "Basic",
  billing_interval: "monthly",
  provider: "paymongo",
  currency: "PHP",
  amount: 999,
  status: "paid",
  paid_at: "2026-10-25T00:00:00Z",
};

const draw = (entry = "/settings/checkout/return?payment=pay1") =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[entry]}>
        <CheckoutReturnPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe("Back from paying", () => {
  afterEach(() => vi.restoreAllMocks());

  it("confirms the payment and says the plan is on", async () => {
    vi.spyOn(billingService, "confirmPayment").mockResolvedValue(payment);
    draw();
    expect(await screen.findByText("You're on Basic")).toBeInTheDocument();
    expect(screen.getByText(/We received ₱999/)).toBeInTheDocument();
    expect(billingService.confirmPayment).toHaveBeenCalledWith("pay1");
  });

  it("offers to try again when the payment failed", async () => {
    vi.spyOn(billingService, "confirmPayment").mockResolvedValue({ ...payment, status: "failed" });
    draw();
    expect(await screen.findByText("The payment didn't go through")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Try again" })).toHaveAttribute(
      "href",
      "/settings/checkout?plan=basic&interval=monthly",
    );
  });

  it("keeps checking while the payment is on its way", async () => {
    vi.spyOn(billingService, "confirmPayment").mockResolvedValue({ ...payment, status: "pending" });
    draw();
    expect(await screen.findByText("Checking your payment…")).toBeInTheDocument();
  });

  it("handles a link with no payment", async () => {
    draw("/settings/checkout/return");
    expect(await screen.findByText("We couldn't find that payment")).toBeInTheDocument();
  });
});
