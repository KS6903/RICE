// PaddyService — typed API client for the paddy domain (Phase F).
// Wraps the shared axios instance; centralizes the paddy endpoints and the
// purchase-form → API-payload transform (extracted from PaddyPage so it's
// unit-testable without HTTP).
import api from "./api";
import type { ChangeEntry } from "./SalesService";

export type PurchaseItemForm = {
  variety_id: string;
  grade_id: string;
  gross_weight_kg: string;
  tare_weight_kg: string;
  moisture_content_pct: string;
  price_per_cavan: string;
};

export type PurchaseForm = {
  /** The warehouse to store the palay in; left out, the recorder's own. */
  branch_id?: string | null;
  purchase_date: string;
  delivery_type: string;
  remarks: string;
  items: PurchaseItemForm[];
};

/** A correction to a saved purchase (palay, rice or by-products): the
 *  header, and its lines in the shape the purchase's create takes. */
export type PurchaseEdit = {
  supplier_id: string | null;
  purchase_date: string;
  delivery_type: string | null;
  remarks: string | null;
  items: Record<string, unknown>[];
};

export class PaddyService {
  constructor(private http = api) {}

  listPurchases(): Promise<any[]> {
    return this.http.get("/paddy/purchases").then((r) => r.data);
  }

  /** Correct a saved palay purchase (edit power); lines sent replace the old. */
  editPurchase(id: string, body: PurchaseEdit): Promise<any> {
    return this.http.patch(`/paddy/purchases/${id}`, body).then((r) => r.data);
  }

  /** Every logged change to one purchase (palay, rice or by-products), newest first. */
  history(
    kind: "palay_purchase" | "rice_purchase" | "byproduct_purchase",
    id: string,
  ): Promise<ChangeEntry[]> {
    return this.http.get(`/paddy/history/${kind}/${id}`).then((r) => r.data);
  }

  listSuppliers(includeInactive = true): Promise<any[]> {
    return this.http
      .get(`/paddy/suppliers?include_inactive=${includeInactive}`)
      .then((r) => r.data);
  }

  listVarieties(includeInactive = false): Promise<any[]> {
    const q = includeInactive ? "?include_inactive=true" : "";
    return this.http.get(`/paddy/varieties${q}`).then((r) => r.data);
  }

  createVariety(body: Record<string, unknown>): Promise<any> {
    return this.http.post("/paddy/varieties", body).then((r) => r.data);
  }

  updateVariety(id: string, body: Record<string, unknown>): Promise<any> {
    return this.http.put(`/paddy/varieties/${id}`, body).then((r) => r.data);
  }

  listGrades(): Promise<any[]> {
    return this.http.get("/paddy/grades").then((r) => r.data);
  }

  createGrade(body: Record<string, unknown>): Promise<any> {
    return this.http.post("/paddy/grades", body).then((r) => r.data);
  }

  listInventory(): Promise<any[]> {
    return this.http.get("/paddy/inventory").then((r) => r.data);
  }

  createSupplier(body: Record<string, unknown>): Promise<any> {
    return this.http.post("/paddy/suppliers", body).then((r) => r.data);
  }

  updateSupplier(id: string, body: Record<string, unknown>): Promise<any> {
    return this.http.put(`/paddy/suppliers/${id}`, body).then((r) => r.data);
  }

  setSupplierActive(id: string, isActive: boolean): Promise<any> {
    return this.http.put(`/paddy/suppliers/${id}`, { is_active: isActive }).then((r) => r.data);
  }

  /** Convert the string-keyed purchase form into the numeric API payload. Pure. */
  static toPurchasePayload(form: PurchaseForm) {
    return {
      ...form,
      items: form.items.map((i) => ({
        variety_id: i.variety_id || null,
        grade_id: i.grade_id || null,
        gross_weight_kg: parseFloat(i.gross_weight_kg),
        tare_weight_kg: parseFloat(i.tare_weight_kg) || 0,
        moisture_content_pct: i.moisture_content_pct ? parseFloat(i.moisture_content_pct) : null,
        price_per_cavan: parseFloat(i.price_per_cavan),
      })),
    };
  }

  createPurchase(form: PurchaseForm): Promise<any> {
    return this.http
      .post("/paddy/purchases", PaddyService.toPurchasePayload(form))
      .then((r) => r.data);
  }
}

export const paddyService = new PaddyService();
