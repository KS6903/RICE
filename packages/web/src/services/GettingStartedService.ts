// GettingStartedService — has this mill done each first step yet?
// Each check asks its list for a single row, so a busy mill pays one tiny
// request per step rather than downloading whole lists.
import api from "./api";

export type StepKey = "paddy" | "milling" | "sales" | "expenses" | "users";

export class GettingStartedService {
  constructor(private http = api) {}

  private any(path: string): Promise<boolean> {
    return this.http
      .get(path, { params: { limit: 1 } })
      .then((r) => Array.isArray(r.data) && r.data.length > 0);
  }

  /** Done = the mill has at least one record of that kind. For users, it's
   *  someone besides the owner who signed up. */
  done(step: StepKey): Promise<boolean> {
    switch (step) {
      case "paddy":
        return this.any("/paddy/purchases");
      case "milling":
        return this.any("/milling/batches");
      case "sales":
        return this.any("/sales/orders");
      case "expenses":
        return this.any("/costs/expenses");
      case "users":
        return this.http.get("/users/").then((r) => Array.isArray(r.data) && r.data.length > 1);
    }
  }
}

export const gettingStartedService = new GettingStartedService();
