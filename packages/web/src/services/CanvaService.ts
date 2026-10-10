// CanvaService — typed API client for the Warehouse view (Inventory → Warehouse):
// the rack/grid view of a branch's pallets and the FIFO dispatch recommendation.
import api from "./api";

export class CanvaService {
  constructor(private http = api) {}

  getRackView(branchId: string, layoutId?: string): Promise<any> {
    const q = layoutId ? `?layout_id=${layoutId}` : "";
    return this.http.get(`/warehouses/${branchId}/rack-view${q}`).then((r) => r.data);
  }

  // ── FIFO dispatch recommendation ─────────────────────────────────────────────
  getVarietyOptions(): Promise<any[]> {
    return this.http.get("/dispatch/variety-options").then((r) => r.data);
  }
  recommendFifo(body: Record<string, unknown>): Promise<any> {
    return this.http.post("/dispatch/recommend", body).then((r) => r.data);
  }
}

export const canvaService = new CanvaService();
