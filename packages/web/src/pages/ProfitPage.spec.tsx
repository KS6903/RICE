import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configure, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { User } from "@rice-mill/shared";
import ProfitPage from "./ProfitPage";
import { useAuthStore } from "../stores/authStore";
import { paddyService } from "../services/PaddyService";
import { profitService } from "../services/ProfitService";

configure({ asyncUtilTimeout: 5000 });

const owner: User = {
  id: "u1",
  username: "mill1",
  full_name: "Mill Owner",
  role: "owner",
  company_id: "c1",
  branch_id: "b1",
  features: ["*"],
};
const staff: User = { ...owner, id: "u2", username: "mill1.accountant", role: "accountant" };

const draw = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <ProfitPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

/** The worked example, typed in. */
const typeTheLot = () => {
  type("Palay (kg)", "1000");
  type("Palay price per kg (₱)", "20");
  type("Other costs per kg of palay (₱)", "1");
  type("Milling recovery %", "65");
  type("Ipa (Rice Hull) %", "22.5");
  type("Darak (Rice Bran) %", "9.5");
  type("Ipa (Rice Hull) per kg (₱)", "1");
  type("Darak (Rice Bran) per kg (₱)", "8");
};

beforeEach(() => {
  vi.spyOn(paddyService, "listVarieties").mockResolvedValue([]);
  vi.spyOn(profitService, "settings").mockResolvedValue({
    target_margin_pct: 10,
    staff_profit_pct: 30,
  });
  vi.spyOn(profitService, "period").mockResolvedValue({
    goods: [{ good: "rice", kg_sold: 100, sales: 4000, cost: 3000, profit: 1000 }],
    overhead: 200,
    total_profit: 800,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  useAuthStore.setState({ user: null });
});

describe("Profit calculator, for the Boss", () => {
  beforeEach(() => {
    useAuthStore.setState({ user: owner });
    vi.spyOn(profitService, "varieties").mockResolvedValue([]);
  });

  it("works out the selling price, the break-even and the profit", async () => {
    draw();
    await screen.findByTestId("profit-calculator");
    typeTheLot();

    const result = screen.getByTestId("profit-result");
    expect(result).toHaveTextContent("₱34.50");
    expect(result).toHaveTextContent("₱30.79");
    expect(result).toHaveTextContent("₱2,410.00");
    expect(result).toHaveTextContent("You won't lose money at this price");
  });

  it("says when it's a losing game, and what would fix it", async () => {
    draw();
    await screen.findByTestId("profit-calculator");
    typeTheLot();
    type("Market price of rice per kg (₱)", "28");

    const alert = within(screen.getByTestId("profit-result")).getByRole("alert");
    expect(alert).toHaveTextContent("losing game");
    expect(alert).toHaveTextContent("₱2.79");
    expect(alert).toHaveTextContent("71.5%");
  });

  it("shows what a typed price earns or loses", async () => {
    draw();
    await screen.findByTestId("profit-calculator");
    typeTheLot();

    type("Sell at (₱ per kg)", "40");
    expect(screen.getByTestId("sell-at-result")).toHaveTextContent("₱5,985.00 profit");
    type("Sell at (₱ per kg)", "30");
    expect(screen.getByTestId("sell-at-result")).toHaveTextContent("₱515.00 loss");
  });

  it("warns about a recovery no mill should see", async () => {
    draw();
    await screen.findByTestId("profit-calculator");
    typeTheLot();
    type("Milling recovery %", "50");
    expect(screen.getByTestId("recovery-warning")).toHaveTextContent("under 55%");
  });

  it("audits the milling from the percentages", async () => {
    draw();
    await screen.findByTestId("profit-calculator");
    typeTheLot();
    type("Head rice %", "51");

    const audit = screen.getByTestId("milling-audit");
    expect(audit).toHaveTextContent("65.0%");
    expect(audit).toHaveTextContent("51.0%");
    expect(audit).toHaveTextContent("78.5%");
  });

  it("saves the Boss's settings", async () => {
    const save = vi
      .spyOn(profitService, "saveSettings")
      .mockResolvedValue({ target_margin_pct: 10, staff_profit_pct: 50 });
    draw();
    await screen.findByTestId("profit-settings");
    type("Profit shown to staff, % of the real one", "50");
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await vi.waitFor(() =>
      expect(save).toHaveBeenCalledWith({ target_margin_pct: 10, staff_profit_pct: 50 }),
    );
  });
});

describe("Profit calculator, for staff", () => {
  beforeEach(() => {
    useAuthStore.setState({ user: staff });
    vi.spyOn(profitService, "varieties").mockResolvedValue([
      {
        variety_id: "v1",
        code: "RC222",
        name: "Rc 222",
        recovery_pct: 65,
        verdict: "good",
        recommended_price: 40,
        estimated_profit_per_kg: 2.77,
      },
      {
        variety_id: "v2",
        code: "RC160",
        name: "Rc 160",
        recovery_pct: 55,
        verdict: "losing",
        recommended_price: 44,
        estimated_profit_per_kg: null,
      },
    ]);
  });

  it("shows the price and the server's lower figure, with no calculator or costs", async () => {
    draw();
    const table = await screen.findByTestId("profit-staff");
    await within(table).findByText("RC222");
    expect(table).toHaveTextContent("₱40.00");
    expect(table).toHaveTextContent("₱2.77");
    expect(table).not.toHaveTextContent("Break-even");

    expect(screen.queryByTestId("profit-calculator")).not.toBeInTheDocument();
    expect(screen.queryByTestId("profit-period")).not.toBeInTheDocument();
    expect(screen.queryByTestId("profit-settings")).not.toBeInTheDocument();
    expect(profitService.settings).not.toHaveBeenCalled();
    expect(profitService.period).not.toHaveBeenCalled();
  });

  it("gives a losing variety no number", async () => {
    draw();
    const table = await screen.findByTestId("profit-staff");
    const row = (await within(table).findByText("RC160")).closest("tr") as HTMLElement;
    expect(row).toHaveTextContent("Losing game");
    expect(within(row).getByText("—")).toBeInTheDocument();
  });
});
