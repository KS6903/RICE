// UsersService — typed API client for the users domain (Phase F).
import api from "./api";

export type UserForm = {
  username: string;
  full_name: string;
  email: string;
  password: string;
  role_id: string;
};

export type UserUpdate = {
  full_name?: string;
  email?: string;
  role_id?: number;
  is_active?: boolean;
};

export class UsersService {
  constructor(private http = api) {}

  list(): Promise<any[]> {
    return this.http.get("/users/").then((r) => r.data);
  }

  /** role_id arrives as a string from the <select>; the API wants an int. Pure. */
  static toCreatePayload(form: UserForm) {
    return { ...form, role_id: parseInt(form.role_id) };
  }

  create(form: UserForm): Promise<any> {
    return this.http.post("/users/", UsersService.toCreatePayload(form)).then((r) => r.data);
  }

  /** Edit another user, or remove (is_active: false) / restore them. The
   *  server refuses to remove you or change your own role. */
  update(id: string, body: UserUpdate): Promise<any> {
    return this.http.put(`/users/${id}`, body).then((r) => r.data);
  }
}

export const usersService = new UsersService();
