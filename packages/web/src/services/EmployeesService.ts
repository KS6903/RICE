// EmployeesService — typed API client for the employees domain (Phase F).
import api from "./api";

export class EmployeesService {
  constructor(private http = api) {}

  list(branchId?: string): Promise<any[]> {
    const q = branchId ? `?branch_id=${branchId}` : "";
    return this.http.get(`/employees/${q}`).then((r) => r.data);
  }

  /** Coerce empty date/number strings to null and parse rates. Pure. */
  static toCreatePayload(form: Record<string, any>) {
    return {
      ...form,
      branch_id: form.branch_id || null,
      date_hired: form.date_hired || null,
      date_terminated: form.date_terminated || null,
      birthdate: form.birthdate || null,
      daily_rate: form.daily_rate ? parseFloat(form.daily_rate) : null,
      monthly_salary: form.monthly_salary ? parseFloat(form.monthly_salary) : null,
    };
  }

  create(form: Record<string, any>): Promise<any> {
    return this.http
      .post("/employees/", EmployeesService.toCreatePayload(form))
      .then((r) => r.data);
  }

  /** Like toCreatePayload, but a blank optional field is sent as null so the
   *  server clears it. Pure. */
  static toUpdatePayload(form: Record<string, any>) {
    const payload: Record<string, any> = EmployeesService.toCreatePayload(form);
    for (const [key, value] of Object.entries(payload)) {
      if (value === "" && key !== "first_name" && key !== "last_name") payload[key] = null;
    }
    return payload;
  }

  update(id: string, form: Record<string, any>): Promise<any> {
    return this.http
      .put(`/employees/${id}`, EmployeesService.toUpdatePayload(form))
      .then((r) => r.data);
  }

  setActive(id: string, isActive: boolean): Promise<any> {
    return this.http.put(`/employees/${id}`, { is_active: isActive }).then((r) => r.data);
  }
}

export const employeesService = new EmployeesService();
