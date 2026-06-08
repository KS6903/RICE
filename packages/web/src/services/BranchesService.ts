// BranchesService — typed API client for branches/company (Phase F).
import api from "./api";

export class BranchesService {
  constructor(private http = api) {}

  list(): Promise<any[]> {
    return this.http.get("/branches/").then((r) => r.data);
  }

  getCompany(): Promise<any> {
    return this.http.get("/branches/company").then((r) => r.data);
  }

  updateCompany(body: Record<string, unknown>): Promise<any> {
    return this.http.put("/branches/company", body).then((r) => r.data);
  }

  create(body: Record<string, unknown>): Promise<any> {
    return this.http.post("/branches/", body).then((r) => r.data);
  }

  update(id: string, body: Record<string, unknown>): Promise<any> {
    return this.http.put(`/branches/${id}`, body).then((r) => r.data);
  }

  bulkDelete(ids: string[]): Promise<any> {
    return this.http.post("/branches/bulk-delete", { ids }).then((r) => r.data);
  }

  listTrash(): Promise<any[]> {
    return this.http.get("/branches/trash").then((r) => r.data);
  }

  restore(id: string): Promise<any> {
    return this.http.post(`/branches/${id}/restore`).then((r) => r.data);
  }
}

export const branchesService = new BranchesService();
