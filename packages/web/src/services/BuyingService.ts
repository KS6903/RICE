// BuyingService — API client for rice (bigas) and by-product purchases, the
// palay purchase's siblings (see PaddyService). Holds the form → payload
// transforms so they're testable without HTTP.
import api from "./api";
import type { PurchaseEdit } from "./PaddyService";

export type RiceLineForm = {
  variety_id: string;
  grade_name: string;
  sack_count: string;
  kg_per_sack: string;
  price_per_sack: string;
};

export type ByproductLineForm = {
  byproduct_type: string;
  weight_kg: string;
  price_per_kg: string;
};

type Header = {
  /** The warehouse to store it in; left out, the recorder's own. */
  branch_id?: string | null;
  purchase_date: string;
  delivery_type: string;
  remarks: string;
};

export type RicePurchaseForm = Header & { items: RiceLineForm[] };
export type ByproductPurchaseForm = Header & { items: ByproductLineForm[] };

const num = (v: string) => parseFloat(String(v).replace(/,/g, ""));

export class BuyingService {
  constructor(private http = api) {}

  static toRicePayload(form: RicePurchaseForm) {
    return {
      ...form,
      items: form.items.map((i) => ({
        variety_id: i.variety_id || null,
        grade_name: i.grade_name || null,
        sack_count: num(i.sack_count),
        kg_per_sack: num(i.kg_per_sack) || 50,
        price_per_sack: num(i.price_per_sack),
      })),
    };
  }

  static toByproductPayload(form: ByproductPurchaseForm) {
    return {
      ...form,
      items: form.items.map((i) => ({
        byproduct_type: i.byproduct_type,
        weight_kg: num(i.weight_kg),
        price_per_kg: num(i.price_per_kg),
      })),
    };
  }

  listRicePurchases(): Promise<any[]> {
    return this.http.get("/paddy/rice-purchases").then((r) => r.data);
  }

  createRicePurchase(form: RicePurchaseForm): Promise<any> {
    return this.http
      .post("/paddy/rice-purchases", BuyingService.toRicePayload(form))
      .then((r) => r.data);
  }

  listRiceStock(): Promise<any[]> {
    return this.http.get("/paddy/rice-stock").then((r) => r.data);
  }

  listByproductPurchases(): Promise<any[]> {
    return this.http.get("/paddy/byproduct-purchases").then((r) => r.data);
  }

  createByproductPurchase(form: ByproductPurchaseForm): Promise<any> {
    return this.http
      .post("/paddy/byproduct-purchases", BuyingService.toByproductPayload(form))
      .then((r) => r.data);
  }

  /** Correct a saved rice purchase (edit power); lines sent replace the old. */
  editRicePurchase(id: string, body: PurchaseEdit): Promise<any> {
    return this.http.patch(`/paddy/rice-purchases/${id}`, body).then((r) => r.data);
  }

  /** Correct a saved by-product purchase (edit power); lines sent replace the old. */
  editByproductPurchase(id: string, body: PurchaseEdit): Promise<any> {
    return this.http.patch(`/paddy/byproduct-purchases/${id}`, body).then((r) => r.data);
  }

  listByproductStock(): Promise<any[]> {
    return this.http.get("/paddy/byproduct-stock").then((r) => r.data);
  }
}

export const buyingService = new BuyingService();
