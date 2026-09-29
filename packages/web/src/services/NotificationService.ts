// NotificationService — typed API client for the signed-in user's notices
// (the bell in the header). The unread count also rides on /auth/me.
import api from "./api";

export type AppNotification = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  created_at: string;
  read: boolean;
};

export class NotificationService {
  constructor(private http = api) {}

  list(limit = 30): Promise<{ items: AppNotification[]; unread: number }> {
    return this.http.get(`/notifications/?limit=${limit}`).then((r) => r.data);
  }

  /** Mark the given notices read, or all of them when no ids are passed. */
  markRead(ids?: string[]): Promise<{ updated: number }> {
    return this.http.post("/notifications/read", { ids: ids ?? null }).then((r) => r.data);
  }
}

export const notificationService = new NotificationService();
