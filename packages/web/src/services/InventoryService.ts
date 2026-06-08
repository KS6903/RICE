// InventoryService — typed API client for the inventory domain (Phase F).
// Wraps the shared axios instance (api.ts, with its auth-refresh + 402
// interceptors) so pages/hooks stop scattering raw `api.get("/inventory/...")`
// string literals. Components stay functional; hooks call these methods.
import api from "./api";

const branchQuery = (branchId?: string) => (branchId ? `?branch_id=${branchId}` : "");

export class InventoryService {
  constructor(private http = api) {}

  getBranches(): Promise<any[]> {
    return this.http.get("/branches/").then((r) => r.data);
  }

  getMilledRice(branchId?: string): Promise<any[]> {
    return this.http.get(`/inventory/milled-rice${branchQuery(branchId)}`).then((r) => r.data);
  }

  getByproducts(branchId?: string): Promise<any[]> {
    return this.http.get(`/inventory/byproducts${branchQuery(branchId)}`).then((r) => r.data);
  }

  getPalay(branchId?: string): Promise<any[]> {
    return this.http.get(`/paddy/inventory${branchQuery(branchId)}`).then((r) => r.data);
  }

  getSummary(branchId?: string): Promise<any> {
    return this.http.get(`/inventory/summary${branchQuery(branchId)}`).then((r) => r.data);
  }

  addStock(body: Record<string, unknown>): Promise<any> {
    return this.http.post("/inventory/stock", body).then((r) => r.data);
  }
}

export const inventoryService = new InventoryService();
