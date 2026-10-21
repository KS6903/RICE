import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AdminSettingsPage from "./AdminSettingsPage";
import { adminService } from "../../services/AdminService";

const pro = {
  id: "p1",
  code: "pro",
  name: "Pro",
  description: null,
  monthly_price: 1499,
  annual_price: 14990,
  annual_discount_percent: 16.6667,
  features: ["paddy"],
  max_branches: 5,
  max_users: 15,
  is_active: true,
  sort_order: 3,
};

const draw = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <AdminSettingsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

afterEach(() => vi.restoreAllMocks());

describe("Admin settings: plan prices", () => {
  it("shows the discount next to the annual price in the list", async () => {
    vi.spyOn(adminService, "getPlans").mockResolvedValue([pro]);
    draw();
    expect(await screen.findByText(/16\.67% off/)).toBeInTheDocument();
  });

  it("works the annual price out from the monthly price and the discount", async () => {
    vi.spyOn(adminService, "getPlans").mockResolvedValue([pro]);
    draw();
    fireEvent.click(await screen.findByTitle("Edit plan"));
    expect(screen.getByTestId("annual-price")).toHaveTextContent("₱14,990");

    fireEvent.change(screen.getByLabelText("Annual discount (%)"), { target: { value: "20" } });
    expect(screen.getByTestId("annual-price")).toHaveTextContent("₱14,390");

    fireEvent.change(screen.getByLabelText("Monthly price (₱)"), { target: { value: "1000" } });
    expect(screen.getByTestId("annual-price")).toHaveTextContent("₱9,600");

    fireEvent.click(screen.getByRole("button", { name: "Use 2 months free" }));
    expect(screen.getByTestId("annual-price")).toHaveTextContent("₱10,000");
  });

  it("sends the discount, not an annual price", async () => {
    vi.spyOn(adminService, "getPlans").mockResolvedValue([pro]);
    const update = vi.spyOn(adminService, "updatePlan").mockResolvedValue(pro);
    draw();
    fireEvent.click(await screen.findByTitle("Edit plan"));
    fireEvent.change(screen.getByLabelText("Annual discount (%)"), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(update).toHaveBeenCalled());
    const [, body] = update.mock.calls[0];
    expect(body).toMatchObject({ monthly_price: 1499, annual_discount_percent: 10 });
    expect(body).not.toHaveProperty("annual_price");
  });

  it("won't save a discount of 100% or more", async () => {
    vi.spyOn(adminService, "getPlans").mockResolvedValue([pro]);
    draw();
    fireEvent.click(await screen.findByTitle("Edit plan"));
    fireEvent.change(screen.getByLabelText("Annual discount (%)"), { target: { value: "100" } });
    expect(screen.getByRole("alert")).toHaveTextContent(/discount has to be/);
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  });
});
