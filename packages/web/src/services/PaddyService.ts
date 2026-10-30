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
  /** What the buyer types; the price per cavan is worked out from it. */
  price_per_kg: string;
  /** Bought wet: saved as Wet, and completed once its drying is recorded from the
   *  purchase's details (the weight and moisture after drying). */
  is_wet: boolean;
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
  price_per_kg: "",
  is_wet: false,
});

const numberOrNull = (v: string) =>
  v !== "" && !Number.isNaN(parseFloat(v)) ? parseFloat(v) : null;

/** A cavan of palay is 50 kg, as on the server. */
const KG_PER_CAVAN = 50;

/** The price per cavan for a price per kilo, to the centavo; null until a price is typed. */
export const pricePerCavan = (pricePerKg: string): number | null => {
  const perKg = numberOrNull(pricePerKg);
  return perKg === null ? null : Math.round(perKg * KG_PER_CAVAN * 100) / 100;
};

/** What a palay line still lacks before it can be saved (true: missing): something
 *  counted (sacks, cavans or kilos; the last two are optional estimates) and a
 *  price. Wet palay needs nothing more: it is saved as Wet. */
export const purchaseLineProblems = (i: PurchaseItemForm) => ({
  counted: !(i.sack_count || i.cavan_count || i.gross_weight_kg),
  price: i.price_per_kg === "",
});

export const purchaseLineReady = (i: PurchaseItemForm): boolean =>
  !Object.values(purchaseLineProblems(i)).some(Boolean);

export type PurchaseForm = {
  /** The branch to store the palay in; left out, the recorder's own. */
  branch_id?: string | null;
  /** The warehouse in that branch; left out, the branch's first. */
  warehouse_id?: string | null;
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

/** A milling-recovery test on a purchase's palay: the sample and what came out of
 *  it, in kilos. The server works out the percentages. */
export type RecoveryTestForm = {
  variety_id: string | null;
  sample_kg: number;
  sample_moisture_pct: number | null;
  milled_kg: number;
  head_rice_kg: number | null;
  husk_kg: number | null;
  bran_kg: number | null;
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

  /** Save a recovery test on a palay purchase; no stock moves. */
  recordRecovery(purchaseId: string, body: RecoveryTestForm): Promise<any> {
    return this.http.post(`/paddy/purchases/${purchaseId}/recovery`, body).then((r) => r.data);
  }

  /** Take a recovery test off a purchase (edit power). */
  removeRecovery(purchaseId: string, testId: string): Promise<any> {
    return this.http
      .delete(`/paddy/purchases/${purchaseId}/recovery/${testId}`)
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
        price_per_cavan: pricePerCavan(i.price_per_kg),
        is_wet: i.is_wet,
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
