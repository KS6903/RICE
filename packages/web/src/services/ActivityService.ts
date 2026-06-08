// ActivityService — typed API client for the audit-log read (Phase F).
import api from "./api";

export class ActivityService {
  constructor(private http = api) {}

  list(): Promise<any[]> {
    return this.http.get("/activity/").then((r) => r.data);
  }
}

export const activityService = new ActivityService();
