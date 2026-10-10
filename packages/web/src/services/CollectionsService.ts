// CollectionsService — typed API client for the Collections page: who to chase
// for money first, what they owe, a reminder to send, and what happened
// (Enterprise, with the automations).
import api from "./api";

export type Outcome = "called" | "no_answer" | "reminder_sent" | "promised" | "paid" | "disputed";

export type Debtor = {
  customer: { id: string; name: string; phone: string | null };
  overdue: number;
  due_soon: number;
  oldest_days_late: number;
  last_paid: string | null;
  /** "broken": promised to pay by a date now past; "waiting": the date is ahead. */
  promise: "broken" | "waiting" | null;
  last_follow_up: string | null;
  last_follow_up_at: string | null;
  invoices: { invoice_no: string; balance: number; due: string; days_late: number }[];
  reminder: string;
};

export type FollowUp = {
  id: string;
  outcome: Outcome;
  summary: string;
  note: string | null;
  created_at: string;
};

export class CollectionsService {
  constructor(private http = api) {}

  list(): Promise<{ today: string; overdue_total: number; customers: Debtor[] }> {
    return this.http.get("/collections/").then((r) => r.data);
  }

  history(customerId: string): Promise<{ follow_ups: FollowUp[] }> {
    return this.http.get(`/collections/${customerId}/follow-ups`).then((r) => r.data);
  }

  record(
    customerId: string,
    body: {
      outcome: Outcome;
      promised_date?: string | null;
      promised_amount?: number | null;
      note?: string;
    },
  ): Promise<{ id: string; summary: string }> {
    return this.http.post(`/collections/${customerId}/follow-ups`, body).then((r) => r.data);
  }
}

export const collectionsService = new CollectionsService();
