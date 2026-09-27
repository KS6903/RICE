// MillingService — typed API client for the milling domain (Phase F).
import api from "./api";

export type BatchInputForm = {
  variety_id: string;
  grade_id: string;
  input_weight_kg: string;
  moisture_content_pct: string;
};

export type BatchOutputForm = {
  output_type: string;
  variety_id: string;
  output_weight_kg: string;
  broken_rice_pct: string;
  grade_name: string;
};

export type BatchForm = {
  equipment_id: string;
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
      inputs: form.inputs.map((i) => ({
        ...i,
        input_weight_kg: parseFloat(i.input_weight_kg),
        moisture_content_pct: i.moisture_content_pct ? parseFloat(i.moisture_content_pct) : null,
        variety_id: i.variety_id || null,
        grade_id: i.grade_id || null,
      })),
      outputs: form.outputs.map((o) => ({
        ...o,
        output_weight_kg: parseFloat(o.output_weight_kg),
        broken_rice_pct: o.broken_rice_pct ? parseFloat(o.broken_rice_pct) : null,
        variety_id: o.variety_id || null,
      })),
    };
  }

  createBatch(form: BatchForm): Promise<any> {
    return this.http
      .post("/milling/batches", MillingService.toBatchPayload(form))
      .then((r) => r.data);
  }
}

export const millingService = new MillingService();
