// UsersService — typed API client for the users domain (Phase F).
import api from "./api";

/** The role picker's value for a role the mill's Boss made up: this, then its id.
 *  A built-in role's value is its number. */
export const CUSTOM_ROLE = "c:";

/** What the server takes for the role picked: a built-in role's id, or a made-up one's. */
export function roleField(value: string): { role_id: number } | { custom_role_id: string } {
  return value.startsWith(CUSTOM_ROLE)
    ? { custom_role_id: value.slice(CUSTOM_ROLE.length) }
    : { role_id: parseInt(value) };
}

export type UserForm = {
  username: string;
  full_name: string;
  email: string;
  password: string;
  /** The role picker's value (see CUSTOM_ROLE). */
  role_id: string;
  /** The signed-in person's own password and, with two-factor on, a current
   *  authenticator code. The server asks for them when the role is Boss or Admin,
   *  or can manage the people here. */
  current_password?: string;
  mfa_code?: string;
};

export type UserUpdate = {
  full_name?: string;
  email?: string;
  role_id?: number;
  /** Instead of role_id: a role the mill's Boss made up. */
  custom_role_id?: string;
  is_active?: boolean;
  /** As on UserForm: asked for when someone is given such a role. */
  current_password?: string;
  mfa_code?: string;
};

/** What giving someone a temporary password returns. The password is shown once and
 *  never stored or emailed; they must replace it at first sign-in, and it expires. */
export type TemporaryPassword = {
  username: string;
  temporary_password: string;
  expires_at: string;
};

export class UsersService {
  constructor(private http = api) {}

  list(): Promise<any[]> {
    return this.http.get("/users/").then((r) => r.data);
  }

  /** The role arrives as the picker's string; the API wants a built-in role's
   *  int, or a made-up role's id under custom_role_id. Pure. */
  static toCreatePayload(form: UserForm) {
    const { role_id, ...rest } = form;
    return { ...rest, ...roleField(role_id) };
  }

  create(form: UserForm): Promise<any> {
    return this.http.post("/users/", UsersService.toCreatePayload(form)).then((r) => r.data);
  }

  /** Edit another user, or remove (is_active: false) / restore them. The
   *  server refuses to remove you or change your own role. */
  update(id: string, body: UserUpdate): Promise<any> {
    return this.http.put(`/users/${id}`, body).then((r) => r.data);
  }

  /** The Boss gives a locked-out member of staff a temporary password. */
  issueTemporaryPassword(id: string): Promise<TemporaryPassword> {
    return this.http.post(`/users/${id}/temporary-password`).then((r) => r.data);
  }
}

export const usersService = new UsersService();
