// ProfitService — API client for the Profit calculator. The server decides what
// each person gets: the real figures go to the Boss alone (services/profit_service.py).
import api from "./api";

export type ProfitDefaults = {
  variety_id: string;
  code: string;
  name: string;
  palay_kg: number | null;
  palay_price: number | null;
  moisture_pct: number | null;
  recovery_pct: number;
  recovery_source: "batches" | "tests" | "variety" | "default";
  head_pct: number | null;
  ipa_pct: number;
  darak_pct: number;
  binlid_pct: number;
  mata_mata_pct: number;
  yields_source: "batches" | "default";
  ipa_price: number | null;
  darak_price: number | null;
  binlid_price: number | null;
  mata_mata_price: number | null;
  other_cost_per_kg: number;
  market_price: number | null;
  market_source: "variety" | "milled" | "all" | null;
};

export type ProfitVerdict = "good" | "thin" | "losing" | "no_data";

/** One variety, as the Boss sees it. */
export type BossVarietyRow = {
  variety_id: string;
  code: string;
  name: string;
  recovery_pct: number;
  verdict: ProfitVerdict;
  break_even: number | null;
  recommended_price: number | null;
  margin_pct: number | null;
  market_price: number | null;
};

/** One variety, as staff see it: no costs, and a lower profit. */
export type StaffVarietyRow = {
  variety_id: string;
  code: string;
  name: string;
  recovery_pct: number;
  verdict: ProfitVerdict;
  recommended_price: number | null;
  estimated_profit_per_kg: number | null;
};

export type ProfitPeriod = {
  goods: {
    good: "palay" | "rice" | "byproduct";
    kg_sold: number;
    sales: number;
    cost: number | null;
    profit: number | null;
  }[];
  overhead: number;
  total_profit: number;
};

export type ProfitSettings = { target_margin_pct: number; staff_profit_pct: number };

export class ProfitService {
  constructor(private http = api) {}

  varieties<Row = BossVarietyRow | StaffVarietyRow>(): Promise<Row[]> {
    return this.http.get("/profit/varieties").then((r) => r.data);
  }

  defaults(varietyId: string): Promise<ProfitDefaults> {
    return this.http.get(`/profit/defaults?variety_id=${varietyId}`).then((r) => r.data);
  }

  period(start: string, end: string): Promise<ProfitPeriod> {
    return this.http.get(`/profit/period?start=${start}&end=${end}`).then((r) => r.data);
  }

  settings(): Promise<ProfitSettings> {
    return this.http.get("/profit/settings").then((r) => r.data);
  }

  saveSettings(body: Partial<ProfitSettings>): Promise<ProfitSettings> {
    return this.http.put("/profit/settings", body).then((r) => r.data);
  }
}

export const profitService = new ProfitService();
