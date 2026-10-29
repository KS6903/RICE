// PaddyService — typed API client for the paddy domain (Phase F).
// Wraps the shared axios instance; centralizes the paddy endpoints and the
// purchase-form → API-payload transform (extracted from PaddyPage so it's
// unit-testable without HTTP).
import api from "./api";
import type { ChangeEntry } from "./SalesService";

export type PurchaseItemForm = {
  variety_id: string;
  grade_id: string;
  /** Counted in sacks; cavans and kilos are optional (kilos not weighed are
   *  taken from the cavans, or else the sacks). */
  sack_count: string;
  cavan_count: string;
  gross_weight_kg: string;
  tare_weight_kg: string;
  /** Moisture when bought: for wet palay, before drying. */
  moisture_content_pct: string;
  price_per_cavan: string;
  /** Bought wet: red until the after-drying weight and moisture are in. */
  is_wet: boolean;
  dried_weight_kg: string;
  dried_moisture_pct: string;
};

/** How the Palay page counts the stock, the Boss's choice for the whole mill. */
export type StockView = "sacks" | "cavans" | "kilos" | "all";

/** A palay line with nothing filled in. */
export const blankPurchaseItem = (): PurchaseItemForm => ({
  variety_id: "",
  grade_id: "",
  sack_count: "",
  cavan_count: "",
  gross_weight_kg: "",
  tare_weight_kg: "0",
  moisture_content_pct: "",
  price_per_cavan: "",
  is_wet: false,
  dried_weight_kg: "",
  dried_moisture_pct: "",
});

const numberOrNull = (v: string) =>
  v !== "" && !Number.isNaN(parseFloat(v)) ? parseFloat(v) : null;

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

  getStockView(): Promise<StockView> {
    return this.http.get("/paddy/stock-view").then((r) => r.data.view);
  }

  /** The Boss only. */
  setStockView(view: StockView): Promise<StockView> {
    return this.http.put("/paddy/stock-view", { view }).then((r) => r.data.view);
  }

  /** A wet line is dry: its weight and moisture after drying. */
  recordDried(
    purchaseId: string,
    itemId: string,
    body: { dried_weight_kg: number; dried_moisture_pct: number | null },
  ): Promise<any> {
    return this.http
      .post(`/paddy/purchases/${purchaseId}/items/${itemId}/dried`, body)
      .then((r) => r.data);
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
        sack_count: numberOrNull(i.sack_count),
        cavan_count: numberOrNull(i.cavan_count),
        gross_weight_kg: numberOrNull(i.gross_weight_kg),
        tare_weight_kg: parseFloat(i.tare_weight_kg) || 0,
        moisture_content_pct: numberOrNull(i.moisture_content_pct),
        price_per_cavan: parseFloat(i.price_per_cavan),
        is_wet: i.is_wet,
        dried_weight_kg: i.is_wet ? numberOrNull(i.dried_weight_kg) : null,
        dried_moisture_pct: i.is_wet ? numberOrNull(i.dried_moisture_pct) : null,
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
