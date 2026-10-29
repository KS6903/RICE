// InventoryService — typed API client for the inventory domain (Phase F).
// Wraps the shared axios instance (api.ts, with its auth-refresh + 402
// interceptors) so pages/hooks stop scattering raw `api.get("/inventory/...")`
// string literals. Components stay functional; hooks call these methods.
import api from "./api";

/** ?branch_id=… and/or &warehouse_id=… ; nothing when neither is picked. */
const placeQuery = (branchId?: string, warehouseId?: string) => {
  const parts = [
    branchId ? `branch_id=${branchId}` : "",
    warehouseId ? `warehouse_id=${warehouseId}` : "",
  ].filter(Boolean);
  return parts.length ? `?${parts.join("&")}` : "";
};

export class InventoryService {
  constructor(private http = api) {}

  getBranches(): Promise<any[]> {
    return this.http.get("/branches/").then((r) => r.data);
  }

  getMilledRice(branchId?: string, warehouseId?: string): Promise<any[]> {
    return this.http.get(`/inventory/milled-rice${placeQuery(branchId, warehouseId)}`).then((r) => r.data);
  }

  getByproducts(branchId?: string, warehouseId?: string): Promise<any[]> {
    return this.http.get(`/inventory/byproducts${placeQuery(branchId, warehouseId)}`).then((r) => r.data);
  }

  getPalay(branchId?: string, warehouseId?: string): Promise<any[]> {
    return this.http.get(`/paddy/inventory${placeQuery(branchId, warehouseId)}`).then((r) => r.data);
  }

  getSummary(branchId?: string, warehouseId?: string): Promise<any> {
    return this.http.get(`/inventory/summary${placeQuery(branchId, warehouseId)}`).then((r) => r.data);
  }

  addStock(body: Record<string, unknown>): Promise<any> {
    return this.http.post("/inventory/stock", body).then((r) => r.data);
  }
}

export const inventoryService = new InventoryService();
