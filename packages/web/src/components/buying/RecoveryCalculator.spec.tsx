import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

const palay = {
  id: "p1",
  reference_no: "PP-20261030-0001",
  supplier_id: null,
  supplier: null,
  purchase_date: "2026-10-30",
  delivery_type: "delivered",
  status: "completed",
  remarks: null,
  total_kg: 950,
  total_amount: 22800,
  item_count: 1,
  recovery_tests: [] as any[],
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

const draw = (purchase: any, canBuy = true) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <PurchaseColumn
        kind="palay"
        purchases={[purchase]}
        canBuy={canBuy}
        onNew={() => undefined}
        empty={<p>none</p>}
      />
    </QueryClientProvider>,
  );

/** Open the purchase and its recovery calculator. */
const openCalculator = async (purchase: any = palay, canBuy = true) => {
  draw(purchase, canBuy);
  fireEvent.click(screen.getByText(purchase.reference_no));
  fireEvent.click(
    within(screen.getByTestId("purchase-details")).getByRole("button", { name: "Recovery" }),
  );
  return screen.findByTestId("recovery-calculator");
};

const fill = (calc: HTMLElement, label: string, value: string) =>
  fireEvent.change(within(calc).getByLabelText(label), { target: { value } });

const fillTest = (calc: HTMLElement) => {
  fill(calc, "Palay sample (kg)", "100");
  fill(calc, "Milled rice (kg)", "65");
  fill(calc, "Head rice (kg)", "52");
  fill(calc, "Husk (kg)", "20");
  fill(calc, "Bran (kg)", "10");
};

describe("The recovery calculator on a palay purchase", () => {
  beforeEach(() => {
    useAuthStore.setState({ user: boss });
    vi.spyOn(paddyService, "listVarieties").mockResolvedValue([
      { id: "v1", code: "RC222", typical_recovery_pct: "66.00" },
    ]);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    useAuthStore.setState({ user: null });
  });

  it("works out the recovery, head rice, broken, husk and bran from the weights", async () => {
    const calc = await openCalculator();
    expect(within(calc).queryByTestId("recovery-result")).toBeNull();

    fillTest(calc);

    const result = within(calc).getByTestId("recovery-result");
    expect(within(result).getByText("65.0%")).toBeTruthy();
    expect(within(result).getByText("32.5 kg")).toBeTruthy();
    expect(within(result).getByText("52.0%")).toBeTruthy();
    expect(within(result).getByText("80.0% of the milled rice")).toBeTruthy();
    // The broken rice and the husk are both 20%.
    expect(within(result).getAllByText("20.0%")).toHaveLength(2);
    expect(within(result).getByText("10.0%")).toBeTruthy();
    expect(within(result).getByText("5.0%")).toBeTruthy();
    // Against the variety's own usual recovery.
    expect(await within(result).findByText("1.0 points below the usual 66%.")).toBeTruthy();
  });

  it("weighs wet palay down to 14% moisture", async () => {
    const calc = await openCalculator();
    fill(calc, "Palay sample (kg)", "100");
    fill(calc, "Moisture of the sample %", "25");
    fill(calc, "Milled rice (kg)", "56.7");

    const result = within(calc).getByTestId("recovery-result");
    expect(within(result).getByText("At 14% moisture")).toBeTruthy();
    expect(within(result).getByText("65.0%")).toBeTruthy();
  });

  it("takes the weights in grams and records them in kilos", async () => {
    const record = vi.spyOn(paddyService, "recordRecovery").mockResolvedValue(palay);
    const calc = await openCalculator();

    fireEvent.click(within(calc).getByRole("radio", { name: "g" }));
    fill(calc, "Palay sample (g)", "50");
    fill(calc, "Milled rice (g)", "32.5");
    fill(calc, "Head rice (g)", "26");

    expect(within(within(calc).getByTestId("recovery-result")).getByText("65.0%")).toBeTruthy();
    fireEvent.click(within(calc).getByRole("button", { name: "Record result" }));

    await waitFor(() =>
      expect(record).toHaveBeenCalledWith("p1", {
        variety_id: "v1",
        sample_kg: 0.05,
        sample_moisture_pct: null,
        milled_kg: 0.0325,
        head_rice_kg: 0.026,
        husk_kg: null,
        bran_kg: null,
      }),
    );
  });

  it("shows what was typed in the other unit when the unit changes, the result the same", async () => {
    const calc = await openCalculator();
    fill(calc, "Palay sample (kg)", "100");
    fill(calc, "Milled rice (kg)", "65");

    fireEvent.click(within(calc).getByRole("radio", { name: "g" }));

    expect((within(calc).getByLabelText("Palay sample (g)") as HTMLInputElement).value).toBe(
      "100000",
    );
    expect((within(calc).getByLabelText("Milled rice (g)") as HTMLInputElement).value).toBe(
      "65000",
    );
    expect(within(within(calc).getByTestId("recovery-result")).getByText("65.0%")).toBeTruthy();

    fireEvent.click(within(calc).getByRole("radio", { name: "kg" }));
    expect((within(calc).getByLabelText("Palay sample (kg)") as HTMLInputElement).value).toBe(
      "100",
    );
  });

  it("records the result on the purchase and closes", async () => {
    const record = vi.spyOn(paddyService, "recordRecovery").mockResolvedValue(palay);
    const calc = await openCalculator();
    fillTest(calc);

    fireEvent.click(within(calc).getByRole("button", { name: "Record result" }));

    await waitFor(() =>
      expect(record).toHaveBeenCalledWith("p1", {
        variety_id: "v1",
        sample_kg: 100,
        sample_moisture_pct: null,
        milled_kg: 65,
        head_rice_kg: 52,
        husk_kg: 20,
        bran_kg: 10,
      }),
    );
    await waitFor(() => expect(screen.queryByTestId("recovery-calculator")).toBeNull());
  });

  it("can be closed without recording anything", async () => {
    const record = vi.spyOn(paddyService, "recordRecovery").mockResolvedValue(palay);
    const calc = await openCalculator();
    fillTest(calc);

    fireEvent.click(within(calc).getByRole("button", { name: "Close calculator" }));

    expect(screen.queryByTestId("recovery-calculator")).toBeNull();
    expect(record).not.toHaveBeenCalled();
  });

  it("won't record weights that can't be true", async () => {
    const calc = await openCalculator();
    fill(calc, "Palay sample (kg)", "100");
    fill(calc, "Milled rice (kg)", "101");

    expect(within(calc).getByRole("alert").textContent).toBe(
      "The milled rice can't weigh more than the palay sample.",
    );
    expect(within(calc).queryByTestId("recovery-result")).toBeNull();
    expect(
      (within(calc).getByRole("button", { name: "Record result" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("only calculates for someone who can't buy palay", async () => {
    const calc = await openCalculator(palay, false);
    fillTest(calc);

    expect(within(calc).getByTestId("recovery-result")).toBeTruthy();
    expect(within(calc).queryByRole("button", { name: "Record result" })).toBeNull();
    expect(within(calc).getByRole("button", { name: "Close calculator" })).toBeTruthy();
  });
});

describe("The recovery tests saved on a purchase", () => {
  const tested = {
    ...palay,
    recovery_tests: [
      {
        id: "t1",
        variety_id: "v1",
        variety_code: "RC222",
        sample_kg: "100.000",
        milled_kg: "65.000",
        recovery_pct: "65.00",
        head_rice_pct: "52.00",
        created_at: "2026-10-30T02:00:00Z",
        created_by_name: "Mill Boss",
      },
    ],
  };

  afterEach(() => {
    vi.restoreAllMocks();
    useAuthStore.setState({ user: null });
  });

  it("are listed in the purchase's window", () => {
    useAuthStore.setState({ user: boss });
    draw(tested);
    fireEvent.click(screen.getByText(tested.reference_no));

    const list = within(screen.getByTestId("purchase-details")).getByTestId("recovery-tests");
    expect(within(list).getByText("65.0%")).toBeTruthy();
    expect(within(list).getByText("52.0%")).toBeTruthy();
    expect(within(list).getByText("Mill Boss")).toBeTruthy();
  });

  it("read a sample under a kilo in grams", () => {
    useAuthStore.setState({ user: boss });
    const small = {
      ...tested,
      recovery_tests: [
        { ...tested.recovery_tests[0], sample_kg: "0.050000", milled_kg: "0.032500" },
      ],
    };
    draw(small);
    fireEvent.click(screen.getByText(small.reference_no));

    const list = screen.getByTestId("recovery-tests");
    expect(within(list).getByText("50 g")).toBeTruthy();
    expect(within(list).getByText("32.5 g")).toBeTruthy();
  });

  it("show nothing when there are none", () => {
    useAuthStore.setState({ user: boss });
    draw(palay);
    fireEvent.click(screen.getByText(palay.reference_no));

    expect(screen.queryByTestId("recovery-tests")).toBeNull();
  });

  it("are taken off by someone with edit power, after asking", async () => {
    useAuthStore.setState({ user: boss });
    const remove = vi.spyOn(paddyService, "removeRecovery").mockResolvedValue(palay);
    draw(tested);
    fireEvent.click(screen.getByText(tested.reference_no));

    fireEvent.click(screen.getByRole("button", { name: "Remove recovery test" }));
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));

    await waitFor(() => expect(remove).toHaveBeenCalledWith("p1", "t1"));
  });

  it("can't be taken off without edit power", () => {
    useAuthStore.setState({ user: { ...boss, role: "cashier", edit_power: false } as User });
    draw(tested);
    fireEvent.click(screen.getByText(tested.reference_no));

    expect(screen.getByTestId("recovery-tests")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remove recovery test" })).toBeNull();
  });
});
