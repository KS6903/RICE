// MaintenanceService — typed API client for the Maintenance page: the mill's
// machines, their service intervals, use since the last service, and the
// services done (Enterprise, with the automations).
import api from "./api";

export type Machine = {
  id: string;
  name: string;
  every_hours: number | null;
  every_tonnes: number | null;
  every_days: number | null;
  last_service_on: string;
  notes: string | null;
  is_active: boolean;
  used: { hours: number; tonnes: number; days: number };
  status: "ok" | "soon" | "due" | "off";
  summary: string;
};

export type MachineIn = {
  name: string;
  every_hours: number | null;
  every_tonnes: number | null;
  every_days: number | null;
  last_service_on: string;
  notes: string;
};

export class MaintenanceService {
  constructor(private http = api) {}

  list(): Promise<{ equipment: Machine[] }> {
    return this.http.get("/equipment/").then((r) => r.data);
  }

  add(body: MachineIn): Promise<Machine> {
    return this.http.post("/equipment/", body).then((r) => r.data);
  }

  service(id: string, body: { done_on: string; note: string }): Promise<Machine> {
    return this.http.post(`/equipment/${id}/service`, body).then((r) => r.data);
  }

  log(id: string): Promise<{
    log: { id: string; done_on: string; note: string | null; done_by: string | null }[];
  }> {
    return this.http.get(`/equipment/${id}/log`).then((r) => r.data);
  }
}

export const maintenanceService = new MaintenanceService();
