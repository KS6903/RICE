// StockCountService — typed API client for the Stock count page: the stock on
// the floor against the records (Enterprise, with the automations).
import api from "./api";

export type SheetLine = {
  kind: "milled_rice" | "palay" | "byproduct";
  inventory_id: string;
  label: string;
  /** The label in parts: the item alone, and the branch when there are several. */
  item: string;
  branch: string | null;
};

export type StockCount = {
  id: string;
  date: string;
  note: string | null;
  counted_by: string | null;
  needs_review: boolean;
  reviewed_by: string | null;
  review_note: string | null;
  lines: {
    label: string;
    recorded_kg: number;
    counted_kg: number;
    difference_kg: number;
    /** Out by more than the allowance. */
    out: boolean;
  }[];
};

export type StockCountPage = {
  /** What to count; no recorded quantities, so the count is blind. */
  sheet: SheetLine[];
  tolerance_pct: number;
  manager: boolean;
  counts: StockCount[];
};

export class StockCountService {
  constructor(private http = api) {}

  page(): Promise<StockCountPage> {
    return this.http.get("/stock-counts/").then((r) => r.data);
  }

  record(body: {
    lines: { kind: SheetLine["kind"]; inventory_id: string; counted_kg: string }[];
    note: string;
  }): Promise<StockCount> {
    return this.http.post("/stock-counts/", body).then((r) => r.data);
  }

  review(id: string, note: string): Promise<StockCount> {
    return this.http.post(`/stock-counts/${id}/review`, { note }).then((r) => r.data);
  }
}

export const stockCountService = new StockCountService();
