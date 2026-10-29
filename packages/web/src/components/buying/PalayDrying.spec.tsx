import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { User } from "@rice-mill/shared";
import PurchaseColumn from "./PurchaseColumn";
import { useAuthStore } from "../../stores/authStore";
import { paddyService } from "../../services/PaddyService";

const boss = {
  id: "u1",
  username: "mill1",
  full_name: "Mill Boss",
  role: "owner",
  company_id: "c1",
  features: ["*"],
  edit_power: true,
} as User;

const purchase = (id: string, ref: string, isWet: boolean, dried: boolean) => ({
  id,
  reference_no: ref,
  supplier: null,
  purchase_date: "2026-10-29",
  delivery_type: "delivered",
  status: isWet && !dried ? "received" : "completed",
  is_drying: isWet && !dried,
  remarks: null,
  total_kg: 1000,
  total_amount: 24000,
  item_count: 1,
  items: [
    {
      id: `${id}-line`,
      variety_code: "NSIC Rc 222",
      sack_count: "20.00",
      gross_weight_kg: "1000.000",
      tare_weight_kg: "0.000",
      net_weight_kg: "1000.000",
      moisture_content_pct: "24.00",
      price_per_cavan: "1200.00",
      is_wet: isWet,
      is_drying: isWet && !dried,
      dried_weight_kg: dried ? "800.000" : null,
      dried_moisture_pct: dried ? "14.00" : null,
      line_total: "24000",
    },
  ],
});

const wet = purchase("p1", "PP-WET", true, false);
const dry = purchase("p2", "PP-DRY", false, false);
const dried = purchase("p3", "PP-DRIED", true, true);

const draw = (canBuy = true) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <PurchaseColumn
        kind="palay"
        purchases={[wet, dry, dried]}
        canBuy={canBuy}
        onNew={() => undefined}
        empty={<p>none</p>}
      />
    </QueryClientProvider>,
  );

const row = (ref: string) => screen.getByText(ref).closest("li") as HTMLElement;

afterEach(() => {
  vi.restoreAllMocks();
  useAuthStore.setState({ user: null });
});

describe("Palay purchases: wet in red, dry in green and completed", () => {
  it("marks a wet purchase red, and a dry or dried one green and completed", () => {
    useAuthStore.setState({ user: boss });
    draw();

    expect(within(row("PP-WET")).getByText("Wet")).toHaveClass("badge-red");
    expect(row("PP-WET")).toHaveClass("border-rose-500");
    for (const ref of ["PP-DRY", "PP-DRIED"]) {
      expect(within(row(ref)).getByText("Completed")).toHaveClass("badge-green");
      expect(row(ref)).toHaveClass("border-emerald-500");
    }
  });

  it("shows each line's sacks, condition, and what it weighs after drying", () => {
    useAuthStore.setState({ user: boss });
    draw();
    fireEvent.click(screen.getByText("PP-DRIED"));

    const details = within(screen.getByTestId("purchase-details"));
    expect(details.getByRole("columnheader", { name: "Sacks" })).toBeInTheDocument();
    expect(details.getByText("Dried")).toHaveClass("badge-green");
    expect(details.getByText("800 kg · 14%")).toBeInTheDocument();
  });

  it("records a wet line as dry from its details", async () => {
    useAuthStore.setState({ user: boss });
    const record = vi.spyOn(paddyService, "recordDried").mockResolvedValue({});
    draw();
    fireEvent.click(screen.getByText("PP-WET"));

    const details = within(screen.getByTestId("purchase-details"));
    // The purchase's status and the line's condition are both red.
    for (const badge of details.getAllByText("Wet")) expect(badge).toHaveClass("badge-red");
    fireEvent.click(details.getByRole("button", { name: "Record drying" }));

    const dialog = within(await screen.findByTestId("record-drying"));
    const mark = dialog.getByRole("button", { name: "Mark as dry" });
    expect(mark).toBeDisabled();
    fireEvent.change(dialog.getByLabelText("Weight after drying (kg)"), {
      target: { value: "800" },
    });
    fireEvent.change(dialog.getByLabelText("Moisture after drying %"), {
      target: { value: "14" },
    });
    fireEvent.click(mark);

    await waitFor(() =>
      expect(record).toHaveBeenCalledWith("p1", "p1-line", {
        dried_weight_kg: 800,
        dried_moisture_pct: 14,
      }),
    );
  });

  it("leaves recording the drying to people who can buy palay", () => {
    useAuthStore.setState({ user: boss });
    draw(false);
    fireEvent.click(screen.getByText("PP-WET"));

    const details = within(screen.getByTestId("purchase-details"));
    expect(details.getAllByText("Wet")).toHaveLength(2);
    expect(details.queryByRole("button", { name: "Record drying" })).toBeNull();
  });
});
