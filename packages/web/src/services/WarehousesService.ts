// WarehousesService — the places inside a branch where stock is kept.
// A branch always has at least one: "Warehouse 1 - <branch name>", made with it.
import api from "./api";

export type Warehouse = {
  id: string;
  branch_id: string;
  name: string;
  /** The branch's first: where stock goes when nobody picks. */
  is_default: boolean;
};

export class WarehousesService {
  constructor(private http = api) {}

  list(branchId?: string): Promise<Warehouse[]> {
    const q = branchId ? `?branch_id=${branchId}` : "";
    return this.http.get(`/warehouses/${q}`).then((r) => r.data);
  }

  /** Add one to a branch; left without a name it is "Warehouse <next number> - <branch>". */
  add(branchId: string, name?: string): Promise<Warehouse> {
    return this.http
      .post("/warehouses/", { branch_id: branchId, name: name?.trim() || null })
      .then((r) => r.data);
  }

  rename(id: string, name: string): Promise<Warehouse> {
    return this.http.put(`/warehouses/${id}`, { name }).then((r) => r.data);
  }

  /** Only one that never held stock or a purchase. */
  remove(id: string): Promise<{ deleted: boolean; id: string }> {
    return this.http.delete(`/warehouses/${id}`).then((r) => r.data);
  }
}

export const warehousesService = new WarehousesService();
