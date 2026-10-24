// CostsService — typed API client for the costs/expenses domain (Phase F).
import api from "./api";
import type { ChangeEntry } from "./SalesService";

export type ExpenseForm = {
  category_id: string;
  batch_id: string;
  expense_date: string;
  amount: string;
  description: string;
  reference_no: string;
};

export type ExpenseEdit = {
  category_id: string;
  batch_id: string | null;
  expense_date: string;
  amount: number;
  description: string | null;
  reference_no: string | null;
};

export class CostsService {
  constructor(private http = api) {}

  listExpenses(): Promise<any[]> {
    return this.http.get("/costs/expenses").then((r) => r.data);
  }

  /** Correct a saved expense (edit power). */
  editExpense(id: string, body: ExpenseEdit): Promise<any> {
    return this.http.patch(`/costs/expenses/${id}`, body).then((r) => r.data);
  }

  /** Every logged change to one expense, newest first. */
  history(id: string): Promise<ChangeEntry[]> {
    return this.http.get(`/costs/history/expense/${id}`).then((r) => r.data);
  }

  listCategories(): Promise<any[]> {
    return this.http.get("/costs/categories").then((r) => r.data);
  }

  createCategory(body: Record<string, unknown>): Promise<any> {
    return this.http.post("/costs/categories", body).then((r) => r.data);
  }

  updateCategory(id: string, body: { name?: string; is_production_cost?: boolean }): Promise<any> {
    return this.http.put(`/costs/categories/${id}`, body).then((r) => r.data);
  }

  /** Delete a category the mill added. One that holds expenses needs `moveTo`:
   *  the category they move to. A default category can't be deleted. */
  deleteCategory(id: string, moveTo?: string): Promise<void> {
    return this.http
      .delete(`/costs/categories/${id}`, { params: moveTo ? { move_to: moveTo } : undefined })
      .then(() => undefined);
  }

  /** Parse the amount and null an empty batch link. Pure. */
  static toExpensePayload(form: ExpenseForm) {
    return { ...form, amount: parseFloat(form.amount), batch_id: form.batch_id || null };
  }

  createExpense(form: ExpenseForm): Promise<any> {
    return this.http
      .post("/costs/expenses", CostsService.toExpensePayload(form))
      .then((r) => r.data);
  }
}

export const costsService = new CostsService();
