// RoleAccessService: which pages each role can open in this mill, the roles the
// Boss made up, and the Boss changing them (backend: /api/role-access).
import api from "./api";

export type AccessLevel = "none" | "view" | "full";

export interface RoleAccessEntry {
  role: string;
  /** Every role but the Boss can be changed. */
  editable: boolean;
  access: Record<string, AccessLevel>;
  defaults: Record<string, AccessLevel>;
  /** Can correct records already saved, every change logged. The Boss always can. */
  edit_power: boolean;
}

/** A role the mill's Boss made up: no default, just its level on every page. */
export interface CustomRoleEntry {
  id: string;
  name: string;
  access: Record<string, AccessLevel>;
  /** Can correct records already saved, every change logged. */
  edit_power: boolean;
  /** How many people hold it; a role with people can't be deleted. */
  people: number;
}

export interface RoleAccessData {
  /** Every page, in the order the checklist shows them. */
  sections: string[];
  roles: RoleAccessEntry[];
  custom_roles: CustomRoleEntry[];
}

export class RoleAccessService {
  constructor(private http = api) {}

  get(): Promise<RoleAccessData> {
    return this.http.get("/role-access/").then((r) => r.data);
  }

  /** Sets one built-in role's level on each page named; a page left out goes
   *  back to its default. Resolves to the whole matrix as it now stands. */
  update(role: string, access: Record<string, AccessLevel>): Promise<RoleAccessData> {
    return this.http.put(`/role-access/${role}`, { access }).then((r) => r.data);
  }

  /** Makes up a role; a page left out of ``access`` is closed to it. */
  createCustom(name: string, access: Record<string, AccessLevel>): Promise<RoleAccessData> {
    return this.http.post("/role-access/custom", { name, access }).then((r) => r.data);
  }

  updateCustom(
    id: string,
    change: { name?: string; access?: Record<string, AccessLevel> },
  ): Promise<RoleAccessData> {
    return this.http.put(`/role-access/custom/${id}`, change).then((r) => r.data);
  }

  deleteCustom(id: string): Promise<RoleAccessData> {
    return this.http.delete(`/role-access/custom/${id}`).then((r) => r.data);
  }

  /** Gives a built-in role edit power, or takes it away. */
  setEditPower(role: string, on: boolean): Promise<RoleAccessData> {
    return this.http.put(`/role-access/${role}/edit-power`, { on }).then((r) => r.data);
  }

  /** Gives a made-up role edit power, or takes it away. */
  setCustomEditPower(id: string, on: boolean): Promise<RoleAccessData> {
    return this.http.put(`/role-access/custom/${id}/edit-power`, { on }).then((r) => r.data);
  }
}

export const roleAccessService = new RoleAccessService();
