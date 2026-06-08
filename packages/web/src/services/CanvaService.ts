// CanvaService — typed API client for the warehouse-canva domain (Phase F).
// Wraps every /warehouses, /pallets, /zones, /layouts, and canva dispatch
// endpoint so the canva components stop scattering raw api calls. (The backend
// canva.py decomposition is Phase 4; this is the frontend half.)
import api from "./api";

export class CanvaService {
  constructor(private http = api) {}

  // ── canva data + reports ────────────────────────────────────────────────────
  getCanva(branchId: string, layoutId?: string): Promise<any> {
    const q = layoutId ? `?layout_id=${layoutId}` : "";
    return this.http.get(`/warehouses/${branchId}/canva${q}`).then((r) => r.data);
  }
  getRackView(branchId: string, layoutId?: string): Promise<any> {
    const q = layoutId ? `?layout_id=${layoutId}` : "";
    return this.http.get(`/warehouses/${branchId}/rack-view${q}`).then((r) => r.data);
  }
  getAgingReport(branchId: string): Promise<any> {
    return this.http.get(`/warehouses/${branchId}/aging-report`).then((r) => r.data);
  }
  getCustomers(branchId: string): Promise<any> {
    return this.http.get(`/canva/customers?branch_id=${branchId}`).then((r) => r.data);
  }
  getZoneTypes(): Promise<any> {
    return this.http.get("/canva/zone-types").then((r) => r.data);
  }
  getSizePresets(): Promise<any[]> {
    return this.http.get("/warehouse-size-presets").then((r) => r.data);
  }

  // ── pallets ─────────────────────────────────────────────────────────────────
  getPalletMovements(palletId: string): Promise<any[]> {
    return this.http.get(`/pallets/${palletId}/movements`).then((r) => r.data);
  }
  movePallet(palletId: string, body: Record<string, unknown>): Promise<any> {
    return this.http.patch(`/pallets/${palletId}/move`, body).then((r) => r.data);
  }
  resizePallet(palletId: string, body: Record<string, unknown>): Promise<any> {
    return this.http.patch(`/pallets/${palletId}/resize`, body).then((r) => r.data);
  }
  stackPallet(palletId: string, body: Record<string, unknown>): Promise<any> {
    return this.http.patch(`/pallets/${palletId}/stack`, body).then((r) => r.data);
  }
  unstackPallet(palletId: string, body: Record<string, unknown>): Promise<any> {
    return this.http.patch(`/pallets/${palletId}/unstack`, body).then((r) => r.data);
  }

  // ── zones + layout geometry ──────────────────────────────────────────────────
  createZone(branchId: string, body: Record<string, unknown>, layoutId?: string): Promise<any> {
    const q = layoutId ? `?layout_id=${layoutId}` : "";
    return this.http.post(`/warehouses/${branchId}/zones${q}`, body).then((r) => r.data);
  }
  patchZone(zoneId: string, body: Record<string, unknown>): Promise<any> {
    return this.http.patch(`/zones/${zoneId}`, body).then((r) => r.data);
  }
  deleteZone(zoneId: string): Promise<any> {
    return this.http.delete(`/zones/${zoneId}`).then((r) => r.data);
  }
  patchLayout(branchId: string, body: Record<string, unknown>, layoutId?: string): Promise<any> {
    const q = layoutId ? `?layout_id=${layoutId}` : "";
    return this.http.patch(`/warehouses/${branchId}/layout${q}`, body).then((r) => r.data);
  }

  // ── layouts ─────────────────────────────────────────────────────────────────
  listLayouts(branchId: string): Promise<any[]> {
    return this.http.get(`/branches/${branchId}/layouts`).then((r) => r.data);
  }
  listLayoutsTrash(branchId: string): Promise<any[]> {
    return this.http.get(`/branches/${branchId}/layouts/trash`).then((r) => r.data);
  }
  createLayout(branchId: string, body: Record<string, unknown>): Promise<any> {
    return this.http.post(`/branches/${branchId}/layouts`, body).then((r) => r.data);
  }
  setDefaultLayout(layoutId: string): Promise<any> {
    return this.http.patch(`/layouts/${layoutId}/set-default`).then((r) => r.data);
  }
  deleteLayout(layoutId: string): Promise<any> {
    return this.http.delete(`/layouts/${layoutId}`).then((r) => r.data);
  }
  bulkDeleteLayouts(ids: string[]): Promise<any> {
    return this.http.post("/layouts/bulk-delete", { ids }).then((r) => r.data);
  }
  restoreLayout(layoutId: string): Promise<any> {
    return this.http.post(`/layouts/${layoutId}/restore`).then((r) => r.data);
  }

  // ── canva dispatch (FIFO recommend) ──────────────────────────────────────────
  getVarietyOptions(): Promise<any[]> {
    return this.http.get("/dispatch/variety-options").then((r) => r.data);
  }
  recommendFifo(body: Record<string, unknown>): Promise<any> {
    return this.http.post("/dispatch/recommend", body).then((r) => r.data);
  }
}

export const canvaService = new CanvaService();
