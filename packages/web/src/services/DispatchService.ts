// DispatchService — typed API client for the dispatch domain (Phase F).
// Routes agent/miller CRUD to the right endpoint per kind and centralizes the
// courier-assignment body shape.
import api from "./api";

export type OperatorKind = "agent" | "miller";
// Who delivers an order: the customer, or the rice mill's own courier (null: nobody yet).
export type CourierChoice = "customer" | "mill" | null;

const resource = (kind: OperatorKind) => (kind === "agent" ? "agents" : "millers");

export class DispatchService {
  constructor(private http = api) {}

  // ── delivery ──────────────────────────────────────────────────────────────

  listOrders(): Promise<any[]> {
    return this.http.get("/dispatch/orders").then((r) => r.data);
  }

  markDelivered(orderId: string): Promise<any> {
    return this.http.patch(`/sales-orders/${orderId}/mark-delivered`).then((r) => r.data);
  }

  /** Take the delivered mark off (owner only, within a week of it being made). */
  unmarkDelivered(orderId: string): Promise<any> {
    return this.http.patch(`/sales-orders/${orderId}/unmark-delivered`).then((r) => r.data);
  }

  /** The assign-courier body: who delivers, and an optional note. Pure. */
  static toCourierBody(choice: CourierChoice, notes = "") {
    const note = notes.trim();
    return { courier_type: choice, notes: choice && note ? note : null };
  }

  assignCourier(orderId: string, choice: CourierChoice, notes = ""): Promise<any> {
    return this.http
      .patch(
        `/sales-orders/${orderId}/assign-courier`,
        DispatchService.toCourierBody(choice, notes),
      )
      .then((r) => r.data);
  }

  // ── operators (agents + millers) ───────────────────────────────────────────

  listAgents(includeInactive = false): Promise<any[]> {
    const q = includeInactive ? "?include_inactive=true" : "";
    return this.http.get(`/agents${q}`).then((r) => r.data);
  }

  listMillers(includeInactive = false): Promise<any[]> {
    const q = includeInactive ? "?include_inactive=true" : "";
    return this.http.get(`/millers${q}`).then((r) => r.data);
  }

  setOperatorActive(kind: OperatorKind, id: string, isActive: boolean): Promise<any> {
    return this.http.put(`/${resource(kind)}/${id}`, { is_active: isActive }).then((r) => r.data);
  }

  createOperator(kind: OperatorKind, body: Record<string, unknown>): Promise<any> {
    return this.http.post(`/${resource(kind)}`, body).then((r) => r.data);
  }

  updateOperator(kind: OperatorKind, id: string, body: Record<string, unknown>): Promise<any> {
    return this.http.put(`/${resource(kind)}/${id}`, body).then((r) => r.data);
  }
}

export const dispatchService = new DispatchService();
