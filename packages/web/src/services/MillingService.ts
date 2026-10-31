// MillingService — typed API client for the milling domain (Phase F).
import api from "./api";
import type { ChangeEntry } from "./SalesService";

export type BatchInputForm = {
  variety_id: string;
  grade_id: string;
  input_weight_kg: string;
  moisture_content_pct: string;
  /** The purchase line this palay came from, when known; else the oldest. */
  purchase_item_id?: string;
};

export type PalayLot = {
  id: string;
  reference_no: string;
  purchase_date: string;
  supplier: string | null;
  free_kg: number;
};

export type BatchOutputForm = {
  output_type: string;
  variety_id: string;
  output_weight_kg: string;
  /** False while the weight is the estimate; true once someone types the weighed kilos. */
  weight_manual?: boolean;
  broken_rice_pct: string;
  grade_name: string;
};

/** Custom milling: what the client and the mill agreed. */
export type ClientArrangement = "client_takes_all" | "mill_keeps_byproducts" | "contracted";

export type MillingClient = {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  is_active: boolean;
};

export type BatchForm = {
  equipment_id: string;
  customer_id: string;
  client_arrangement: ClientArrangement;
  client_notes: string;
  start_datetime: string;
  remarks: string;
  inputs: BatchInputForm[];
  outputs: BatchOutputForm[];
};

export class MillingService {
  constructor(private http = api) {}

  listBatches(): Promise<any[]> {
    return this.http.get("/milling/batches").then((r) => r.data);
  }

  listEquipment(includeInactive = false): Promise<any[]> {
    const q = includeInactive ? "?include_inactive=true" : "";
    return this.http.get(`/milling/equipment${q}`).then((r) => r.data);
  }

  /** Customers whose palay a batch is milled for, with how to reach them. */
  listClients(): Promise<MillingClient[]> {
    return this.http.get("/milling/clients").then((r) => r.data);
  }

  createEquipment(body: Record<string, unknown>): Promise<any> {
    return this.http.post("/milling/equipment", body).then((r) => r.data);
  }

  updateEquipment(id: string, body: Record<string, unknown>): Promise<any> {
    return this.http.put(`/milling/equipment/${id}`, body).then((r) => r.data);
  }

  /** Convert the string-keyed batch form into the numeric API payload. Pure. */
  static toBatchPayload(form: BatchForm) {
    return {
      ...form,
      equipment_id: form.equipment_id || null,
      customer_id: form.customer_id || null,
      // Terms only mean something for a client's palay.
      client_arrangement: form.customer_id ? form.client_arrangement : null,
      client_notes: (form.customer_id && form.client_notes.trim()) || null,
      inputs: form.inputs.map((i) => ({
        ...i,
        input_weight_kg: parseFloat(i.input_weight_kg),
        moisture_content_pct: i.moisture_content_pct ? parseFloat(i.moisture_content_pct) : null,
        variety_id: i.variety_id || null,
        grade_id: i.grade_id || null,
        purchase_item_id: i.purchase_item_id || null,
      })),
      outputs: form.outputs.map(({ weight_manual: _manual, ...o }) => ({
        ...o,
        output_weight_kg: parseFloat(o.output_weight_kg),
        broken_rice_pct: o.broken_rice_pct ? parseFloat(o.broken_rice_pct) : null,
        variety_id: o.variety_id || null,
      })),
    };
  }

  limits(): Promise<{
    mrr_alert_pct: number;
    broken_alert_pct: number;
    unaccounted_alert_pct: number;
  }> {
    return this.http.get("/milling/limits").then((r) => r.data);
  }

  lots(varietyId: string): Promise<PalayLot[]> {
    return this.http
      .get("/milling/lots", { params: varietyId ? { variety_id: varietyId } : {} })
      .then((r) => r.data);
  }

  createBatch(form: BatchForm): Promise<any> {
    return this.http
      .post("/milling/batches", MillingService.toBatchPayload(form))
      .then((r) => r.data);
  }

  /** Correct a saved batch (edit power); inputs and outputs sent replace the
   *  old ones, and stock follows. */
  editBatch(id: string, body: Record<string, unknown>): Promise<any> {
    return this.http.patch(`/milling/batches/${id}`, body).then((r) => r.data);
  }

  /** Every logged change to one batch, newest first. */
  history(id: string): Promise<ChangeEntry[]> {
    return this.http.get(`/milling/history/milling_batch/${id}`).then((r) => r.data);
  }
}

export const millingService = new MillingService();
