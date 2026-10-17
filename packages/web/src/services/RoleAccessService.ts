// RoleAccessService: which pages each role can open in this mill, and the Boss
// changing it (backend: /api/role-access).
import api from "./api";

export type AccessLevel = "none" | "view" | "full";

export interface RoleAccessEntry {
  role: string;
  /** The Boss and the Admin always have full access and can't be changed. */
  editable: boolean;
  access: Record<string, AccessLevel>;
  defaults: Record<string, AccessLevel>;
}

export interface RoleAccessData {
  /** The pages the Boss can open to a role, or take away from it. */
  sections: string[];
  /** The pages that are the same for everyone (Users, Settings, ...). */
  locked_sections: string[];
  roles: RoleAccessEntry[];
}

export class RoleAccessService {
  constructor(private http = api) {}

  get(): Promise<RoleAccessData> {
    return this.http.get("/role-access/").then((r) => r.data);
  }

  /** Sets one staff role's level on each page named; a page left out goes back
   *  to its default. Resolves to the whole matrix as it now stands. */
  update(role: string, access: Record<string, AccessLevel>): Promise<RoleAccessData> {
    return this.http.put(`/role-access/${role}`, { access }).then((r) => r.data);
  }
}

export const roleAccessService = new RoleAccessService();
