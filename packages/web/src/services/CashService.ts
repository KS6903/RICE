// CashService — typed API client for the Cash count page: the drawer counted at
// close against what it should hold (Enterprise, with the automations).
import api from "./api";

export type CashCount = {
  id: string;
  date: string;
  opening: number;
  cash_in: number;
  cash_out: number;
  expected: number;
  counted: number;
  taken_out: number;
  /** Counted less expected: below zero is short. */
  difference: number;
  note: string | null;
  counted_by: string | null;
  needs_review: boolean;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
};

export type CashPage = {
  today: {
    date: string;
    opening: number;
    cash_received: { who: string; amount: number }[];
    cash_in: number;
    /** Expenses entered today: some may have been paid from the drawer. */
    expenses_entered: number;
  };
  tolerance: number;
  manager: boolean;
  counts: CashCount[];
};

export class CashService {
  constructor(private http = api) {}

  page(): Promise<CashPage> {
    return this.http.get("/cash/").then((r) => r.data);
  }

  count(body: {
    counted: string;
    cash_out: string;
    taken_out: string;
    opening?: string;
    note: string;
  }): Promise<CashCount> {
    return this.http.post("/cash/", body).then((r) => r.data);
  }

  review(id: string, note: string): Promise<CashCount> {
    return this.http.post(`/cash/${id}/review`, { note }).then((r) => r.data);
  }
}

export const cashService = new CashService();
