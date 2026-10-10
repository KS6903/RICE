// TasksService — typed API client for the To do page: alerts someone is fixing,
// by when, and whether they're done (Enterprise, with the automations).
import api from "./api";

export type Task = {
  id: string;
  source: string;
  title: string;
  body: string | null;
  link: string | null;
  status: "open" | "acknowledged" | "resolved";
  assignee: { id: string; name: string } | null;
  due_at: string;
  overdue: boolean;
  created_at: string;
  acknowledged_at: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution: string | null;
};

export type TaskList = {
  tasks: Task[];
  /** Owners and admins see everyone's tasks and assign them. */
  manager: boolean;
  /** Open tasks nobody has been given yet (managers only). */
  unassigned: number;
};

export type Assignable = { id: string; name: string; role: string | null };

export class TasksService {
  constructor(private http = api) {}

  list(scope: "mine" | "all", done = false): Promise<TaskList> {
    return this.http.get(`/actions/?scope=${scope}&done=${done}`).then((r) => r.data);
  }

  /** Who a task from this source (an automation's code, or "manual") may go to. */
  people(source: string): Promise<{ people: Assignable[] }> {
    return this.http
      .get(`/actions/people?source=${encodeURIComponent(source)}`)
      .then((r) => r.data);
  }

  fromNotice(body: {
    notification_id: string;
    assignee_id?: string | null;
    due_at: string;
  }): Promise<Task> {
    return this.http.post("/actions/", body).then((r) => r.data);
  }

  acknowledge(id: string): Promise<Task> {
    return this.http.post(`/actions/${id}/acknowledge`).then((r) => r.data);
  }

  resolve(id: string, note: string): Promise<Task> {
    return this.http.post(`/actions/${id}/resolve`, { note }).then((r) => r.data);
  }

  assign(id: string, body: { assignee_id: string; due_at?: string }): Promise<Task> {
    return this.http.post(`/actions/${id}/assign`, body).then((r) => r.data);
  }
}

export const tasksService = new TasksService();
