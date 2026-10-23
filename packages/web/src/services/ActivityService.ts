// ActivityService — typed API client for the audit-log read (Phase F).
import api from "./api";

export class ActivityService {
  constructor(private http = api) {}

  /** The log from `start` to `end` (yyyy-MM-dd, whole days, at most 31); the
   *  last month when no range is given. */
  list(range?: { start: string; end: string }): Promise<any[]> {
    return this.http.get("/activity/", { params: range }).then((r) => r.data);
  }
}

export const activityService = new ActivityService();
