// SavingsService — API client for the Savings page. Its figures are the Boss's alone
// (services/savings_service.py); only priceCheck is open to whoever sells.
import api from "./api";

export type SavingsSettings = {
  pay_deductions: boolean;
  weight_lock: boolean;
  mrr_alert_pct: number;
  broken_alert_pct: number;
  unaccounted_alert_pct: number;
  break_even_utilization_pct: number;
  optimal_low_pct: number;
  optimal_high_pct: number;
  working_days_per_week: number;
  tariff_pct: number;
  cif_usd_per_ton: number | null;
  usd_php: number | null;
  landed_other_per_kg: number;
  packaging_per_sack: number;
  kg_per_sack: number;
  bran_fresh_days: number;
  head_low_pct: number;
  bran_low_pct: number;
  bran_high_pct: number;
  hull_low_pct: number;
  hull_high_pct: number;
  binlid_high_pct: number;
  broken_spike_points: number;
  wholesale_price: number | null;
  block_below_cost: boolean;
  hold_moisture_over: number | null;
  auto_hold_readings: boolean;
  fresh_days: Record<string, number>;
};

export type UtilizationBand =
  "no_data" | "below_break_even" | "above_break_even" | "optimal" | "over_target";

export type SavingsOverview = {
  lookback_days: number;
  deducted_kg: number;
  deducted_php: number;
  batches_flagged: number;
  batches_checked: number;
  unaccounted_kg: number;
  utilization_pct: number | null;
  utilization_band: UtilizationBand;
  held_kg: number;
  vale_open_php: number;
};

export type MaxBuyRow = {
  variety_id: string;
  code: string;
  name: string;
  paying_per_kg: number | null;
  recovery_pct: number;
  market_price: number | null;
  max_at_market: number | null;
  max_at_import: number | null;
  max_buy: number | null;
};
export type MaxBuy = { landed_price: number | null; target_margin_pct: number; rows: MaxBuyRow[] };

export type BatchBalance = {
  input_kg: number;
  milled_kg: number;
  recovery_pct: number | null;
  head_pct: number | null;
  broken_pct: number | null;
  binlid_pct: number | null;
  darak_pct: number | null;
  ipa_pct: number | null;
  other_kg: number;
  unaccounted_kg: number;
  unaccounted_pct: number | null;
  complete: boolean;
};
export type BatchRow = {
  id: string;
  batch_no: string;
  start_datetime: string;
  balance: BatchBalance;
  alerts: (
    | "low_recovery"
    | "high_broken"
    | "unaccounted"
    | "low_head"
    | "bran_range"
    | "hull_range"
    | "binlid_high"
    | "broken_spike"
  )[];
  cause: "missing_kilos" | "machine" | "palay_or_machine" | null;
};
export type BatchTrace = {
  id: string;
  batch_no: string;
  client: string | null;
  input_kg: number;
  lots: {
    weight_kg: number;
    reference_no: string | null;
    purchase_date: string | null;
    supplier: string | null;
    moisture_pct: number | null;
    bought_kg: number | null;
    dried_kg: number | null;
    dried_moisture_pct: number | null;
  }[];
  outputs: { output_type: string; weight_kg: number }[];
  sold: { order_no: string; customer: string | null; weight_kg: number }[];
};

export type PalletRow = {
  id: string;
  pallet_code: string;
  variety_code: string | null;
  weight_kg: number;
  milling_date: string;
  days_old: number;
  aging_status: "fresh" | "warning" | "critical" | "expired";
  status: "in_storage" | "on_hold";
  date_assumed: boolean;
  pick_first_reason: string | null;
};
export type HoldReason = "moisture" | "pests" | "mould" | "contaminant" | "other";
export type HoldRow = {
  id: string;
  pallet_code: string | null;
  stock_type: string;
  byproduct_type: string | null;
  weight_kg: number;
  reason: HoldReason;
  note: string | null;
  placed_at: string;
};
export type ZoneRow = {
  id: string;
  name: string;
  target_humidity_pct: number | null;
  target_temp_c: number | null;
  humidity_pct: number | null;
  temp_c: number | null;
  read_at: string | null;
  out_of_range: boolean;
};
export type ByproductRow = {
  byproduct_type: string;
  on_hand_kg: number;
  sold_30d_kg: number;
  oldest_days: number | null;
  fresh_days: number | null;
  stale: boolean;
  awaiting_dispatch_kg: number;
  awaiting_days: number | null;
};
export type WarehouseSavings = {
  pallets: PalletRow[];
  holds: HoldRow[];
  zones: ZoneRow[];
  byproducts: ByproductRow[];
};
export type Movement = {
  id: string;
  stock_type: string;
  byproduct_type: string | null;
  grade_name: string | null;
  delta_kg: number;
  balance_after_kg: number;
  source_type: string;
  notes: string | null;
  created_at: string;
};

export type CapacityRow = {
  milled_kg: number;
  rated_kg: number | null;
  pct: number | null;
  band: UtilizationBand;
};
export type Capacity = {
  machines: number;
  rated_per_day_kg: number | null;
  today: CapacityRow;
  week: CapacityRow;
  weeks: (CapacityRow & { week_of: string })[];
  settings: { break_even: number; optimal_low: number; optimal_high: number };
};
export type CostPerSack = {
  kg_per_sack: number;
  rows: {
    variety_id: string;
    code: string;
    name: string;
    palay: number;
    other: number;
    packaging: number;
    byproducts: number;
    total: number;
    market: number | null;
    below_cost: boolean;
  }[];
  per_ton: { category: string; per_ton: number }[];
};
export type Advances = {
  open_php: number;
  rows: {
    id: string;
    supplier_id: string;
    supplier: string | null;
    advance_date: string;
    kind: "cash" | "inputs";
    amount: number;
    settled: number;
    open: number;
    note: string | null;
  }[];
};

export type FarmerBalance = {
  supplier_id: string;
  supplier: string | null;
  bought: number;
  vale: number;
  paid: number;
  to_pay: number;
  vale_open: number;
};

export class SavingsService {
  constructor(private http = api) {}

  overview = (): Promise<SavingsOverview> => this.http.get("/savings/overview").then((r) => r.data);
  settings = (): Promise<SavingsSettings> => this.http.get("/savings/settings").then((r) => r.data);
  saveSettings = (body: Partial<SavingsSettings>): Promise<SavingsSettings> =>
    this.http.put("/savings/settings", body).then((r) => r.data);
  maxBuy = (): Promise<MaxBuy> => this.http.get("/savings/max-buy").then((r) => r.data);
  batches = (): Promise<BatchRow[]> => this.http.get("/savings/batches").then((r) => r.data);
  trace = (id: string): Promise<BatchTrace> =>
    this.http.get(`/savings/batches/${id}/trace`).then((r) => r.data);
  warehouse = (): Promise<WarehouseSavings> =>
    this.http.get("/savings/warehouse").then((r) => r.data);
  movements = (stockType?: string): Promise<Movement[]> =>
    this.http
      .get("/savings/movements", { params: stockType ? { stock_type: stockType } : {} })
      .then((r) => r.data);
  pickFirst = (id: string, reason?: string) =>
    this.http.post(`/savings/pallets/${id}/pick-first`, { reason }).then((r) => r.data);
  placeHold = (body: {
    pallet_id?: string;
    stock_type?: string;
    variety_id?: string;
    byproduct_type?: string;
    weight_kg?: number;
    reason: HoldReason;
    note?: string;
  }) => this.http.post("/savings/holds", body).then((r) => r.data);
  clearHold = (id: string, note?: string) =>
    this.http.post(`/savings/holds/${id}/clear`, { note }).then((r) => r.data);
  addReading = (body: { zone_id: string; humidity_pct?: number; temp_c?: number }) =>
    this.http.post("/savings/readings", body).then((r) => r.data);
  capacity = (): Promise<Capacity> => this.http.get("/savings/capacity").then((r) => r.data);
  costPerSack = (): Promise<CostPerSack> =>
    this.http.get("/savings/cost-per-sack").then((r) => r.data);
  advances = (): Promise<Advances> => this.http.get("/savings/advances").then((r) => r.data);
  createAdvance = (body: {
    supplier_id: string;
    advance_date: string;
    kind: "cash" | "inputs";
    amount: number;
    note?: string;
  }) => this.http.post("/savings/advances", body).then((r) => r.data);
  farmers = (): Promise<FarmerBalance[]> => this.http.get("/savings/farmers").then((r) => r.data);
  payFarmer = (body: { supplier_id: string; paid_on: string; amount: number; note?: string }) =>
    this.http.post("/savings/farmers/pay", body).then((r) => r.data);
  setPalletDate = (id: string, milling_date: string) =>
    this.http.post(`/savings/pallets/${id}/date`, { milling_date }).then((r) => r.data);
  setupFloorPlan = (): Promise<{ pallets: number }> =>
    this.http.post("/savings/floor-plan").then((r) => r.data);
  voidAdvance = (id: string) => this.http.post(`/savings/advances/${id}/void`).then((r) => r.data);
  /** The pallets a sale took, and where they stand. */
  pickList = (
    orderId: string,
  ): Promise<{ pallet_code: string; zone: string | null; weight_kg: number }[]> =>
    this.http.get(`/savings/orders/${orderId}/pick-list`).then((r) => r.data);
  /** Which proposed prices are under cost. Only the Boss's answer carries the figure. */
  priceCheck = (
    items: {
      item_type?: string;
      byproduct_type?: string | null;
      variety_id: string | null;
      price: number;
    }[],
  ): Promise<{ below: boolean; floor: number | null }[]> =>
    this.http.post("/savings/price-check", { items }).then((r) => r.data);
}

export const savingsService = new SavingsService();
