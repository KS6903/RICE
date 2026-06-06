// DispatchService — typed API client for the dispatch domain (Phase F).
// Routes agent/miller CRUD to the right endpoint per kind and centralizes the
// courier-assignment body shape.
import api from "./api";

export type OperatorKind = "agent" | "miller";
export type CourierPick = { kind: OperatorKind; id: string } | null;

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

  /** Build the assign-courier body from a picked operator (or null = clear). Pure. */
  static toCourierBody(pick: CourierPick) {
    return {
      agent_id: pick?.kind === "agent" ? pick.id : null,
      miller_id: pick?.kind === "miller" ? pick.id : null,
    };
  }

  assignCourier(orderId: string, pick: CourierPick): Promise<any> {
    return this.http
      .patch(`/sales-orders/${orderId}/assign-courier`, DispatchService.toCourierBody(pick))
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
