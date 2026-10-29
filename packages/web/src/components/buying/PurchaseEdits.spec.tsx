import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { User } from "@rice-mill/shared";
import PurchaseColumn from "./PurchaseColumn";
import { useAuthStore } from "../../stores/authStore";
import { paddyService } from "../../services/PaddyService";
import { buyingService } from "../../services/BuyingService";
import { byproductKindService } from "../../services/ByproductKindService";
import { chooseOption } from "../../test/pickers";

const boss = {
  id: "u1",
  username: "mill1",
  full_name: "Mill Boss",
  role: "owner",
  company_id: "c1",
  features: ["*"],
  edit_power: true,
} as User;

const palay = {
  id: "p1",
  reference_no: "PP-20261020-0001",
  supplier_id: null,
  supplier: null,
  purchase_date: "2026-10-20",
  delivery_type: "delivered",
  status: "received",
  remarks: null,
  total_kg: 950,
  total_amount: 22800,
  item_count: 1,
  items: [
    {
      id: "i1",
      variety_id: "v1",
      variety_code: "RC222",
      grade_id: null,
      grade_code: null,
      gross_weight_kg: "1000.000",
      tare_weight_kg: "50.000",
      net_weight_kg: "950.000",
      moisture_content_pct: null,
      price_per_cavan: "1200.00",
      line_total: "22800",
    },
  ],
};

const rice = {
  ...palay,
  id: "r1",
  reference_no: "RP-20261020-0001",
  items: [
    {
      id: "i2",
      variety_id: "v1",
      variety_code: "RC222",
      grade_name: "Graded Rice",
      sack_count: "20.00",
      kg_per_sack: "50.00",
      weight_kg: "1000",
      price_per_sack: "2400.00",
      line_total: "48000",
    },
  ],
};

const draw = (kind: "palay" | "rice", purchase: any, canBuy = true) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <PurchaseColumn
        kind={kind}
        purchases={[purchase]}
        canBuy={canBuy}
        onNew={() => undefined}
        empty={<p>none</p>}
      />
    </QueryClientProvider>,
  );

const openPurchase = (ref: string) => fireEvent.click(screen.getByText(ref));

describe("Correcting a saved purchase", () => {
  beforeEach(() => {
    vi.spyOn(paddyService, "listSuppliers").mockResolvedValue([{ id: "s1", name: "Mang Ben" }]);
    vi.spyOn(paddyService, "listVarieties").mockResolvedValue([
      { id: "v1", code: "RC222", kind: "both" },
      { id: "v2", code: "RC160", kind: "both" },
    ]);
    vi.spyOn(paddyService, "listGrades").mockResolvedValue([{ id: "g1", code: "A" }]);
    vi.spyOn(byproductKindService, "list").mockResolvedValue([]);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    useAuthStore.setState({ user: null });
  });

  it("the Boss corrects a palay purchase's line and supplier", async () => {
    useAuthStore.setState({ user: boss });
    const save = vi.spyOn(paddyService, "editPurchase").mockResolvedValue(palay);
    draw("palay", palay);

    openPurchase("PP-20261020-0001");
    fireEvent.click(
      within(screen.getByTestId("purchase-details")).getByRole("button", { name: /Edit/ }),
    );
    const dialog = await screen.findByTestId("edit-purchase");

    fireEvent.change(within(dialog).getByLabelText("Kilos (est.) of line 1"), {
      target: { value: "1200" },
    });
    fireEvent.change(within(dialog).getByLabelText("Moisture % of line 1"), {
      target: { value: "14" },
    });
    await chooseOption("Supplier", "Mang Ben", within(dialog));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(save).toHaveBeenCalledWith("p1", {
        supplier_id: "s1",
        purchase_date: "2026-10-20",
        delivery_type: "delivered",
        remarks: null,
        items: [
          {
            variety_id: "v1",
            grade_id: null,
            sack_count: null,
            cavan_count: null,
            gross_weight_kg: 1200,
            tare_weight_kg: 50,
            moisture_content_pct: 14,
            price_per_cavan: 1200,
            is_wet: false,
            dried_weight_kg: null,
            dried_moisture_pct: null,
          },
        ],
      }),
    );
  });

  it("a rice purchase's grade is corrected", async () => {
    useAuthStore.setState({ user: boss });
    const save = vi.spyOn(buyingService, "editRicePurchase").mockResolvedValue(rice);
    draw("rice", rice);

    openPurchase("RP-20261020-0001");
    fireEvent.click(
      within(screen.getByTestId("purchase-details")).getByRole("button", { name: /Edit/ }),
    );
    const dialog = await screen.findByTestId("edit-purchase");
    await chooseOption("Grade of line 1", "Straight Mill Rice", within(dialog));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0][1].items).toEqual([
      {
        variety_id: "v1",
        grade_name: "Straight Mill Rice",
        sack_count: 20,
        kg_per_sack: 50,
        price_per_sack: 2400,
      },
    ]);
  });

  it("a line that makes no sense can't be saved", async () => {
    useAuthStore.setState({ user: boss });
    draw("palay", palay);
    openPurchase("PP-20261020-0001");
    fireEvent.click(
      within(screen.getByTestId("purchase-details")).getByRole("button", { name: /Edit/ }),
    );
    const dialog = await screen.findByTestId("edit-purchase");
    fireEvent.change(within(dialog).getByLabelText("Gross kg of line 1"), {
      target: { value: "40" },
    });
    expect(within(dialog).getByRole("button", { name: "Save changes" })).toBeDisabled();
  });

  it("without edit power, the popup shows the history but no Edit", async () => {
    useAuthStore.setState({ user: { ...boss, role: "encoder", edit_power: false } });
    vi.spyOn(paddyService, "history").mockResolvedValue([
      {
        id: "h1",
        action: "palay_purchase.edit",
        user_name: "Mill Boss",
        detail: "Supplier: blank → Mang Ben",
        created_at: "2026-10-21T08:00:00Z",
      },
    ]);
    draw("palay", palay);

    openPurchase("PP-20261020-0001");
    const details = screen.getByTestId("purchase-details");
    expect(within(details).queryByRole("button", { name: /Edit/ })).not.toBeInTheDocument();
    fireEvent.click(within(details).getByRole("button", { name: /History/ }));
    expect(await screen.findByText("Supplier: blank → Mang Ben")).toBeInTheDocument();
    expect(paddyService.history).toHaveBeenCalledWith("palay_purchase", "p1");
  });
});
