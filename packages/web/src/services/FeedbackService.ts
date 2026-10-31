// FeedbackService — typed API client for Settings > Feedback: a rating of the app
// and why it was given. BossAdmin reads them through AdminService.
import api from "./api";

export type Feedback = {
  id: string;
  rating: number;
  reasons: string[];
  other_text: string | null;
  created_at: string;
};

export class FeedbackService {
  constructor(private http = api) {}

  latest(): Promise<Feedback | null> {
    return this.http.get("/feedback").then((r) => r.data);
  }

  send(body: { rating: number; reasons: string[]; other_text: string | null }): Promise<Feedback> {
    return this.http.post("/feedback", body).then((r) => r.data);
  }
}

export const feedbackService = new FeedbackService();
