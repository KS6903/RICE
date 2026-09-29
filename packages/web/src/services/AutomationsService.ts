// AutomationsService — typed API client for the Enterprise-only Automations
// page: ready-made recipes the mill switches on (morning summary, reminders...).
import api from "./api";

export type AutomationField = {
  name: string;
  label: string;
  kind: "time" | "bool" | "number" | "money" | "percent";
  help: string;
};

export type AutomationRun = {
  run_key: string;
  status: "running" | "succeeded" | "failed";
  started_at: string;
  finished_at: string | null;
  detail: string | null;
};

export type AutomationCandidate = { id: string; name: string; role: string | null };

export type Automation = {
  code: string;
  title: string;
  description: string;
  group: "reports" | "watch" | "stock" | "receivables";
  fields: AutomationField[];
  params: Record<string, string | number | boolean>;
  enabled: boolean;
  recipients: string[];
  effective_recipients: string[];
  default_roles: string[];
  candidates: AutomationCandidate[];
  last_run: AutomationRun | null;
};

export type AutomationUpdate = {
  enabled: boolean;
  params: Record<string, string | number | boolean>;
  recipients: string[];
};

export class AutomationsService {
  constructor(private http = api) {}

  list(): Promise<{ recipes: Automation[] }> {
    return this.http.get("/automations/").then((r) => r.data);
  }

  update(code: string, body: AutomationUpdate): Promise<Automation> {
    return this.http.put(`/automations/${code}`, body).then((r) => r.data);
  }

  sendTest(code: string): Promise<{ sent: number }> {
    return this.http.post(`/automations/${code}/test`).then((r) => r.data);
  }

  runs(code: string): Promise<{ runs: AutomationRun[] }> {
    return this.http.get(`/automations/${code}/runs`).then((r) => r.data);
  }
}

export const automationsService = new AutomationsService();
