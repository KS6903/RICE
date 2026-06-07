// AuthService — typed API client for account self-service (Phase F).
// Wraps the /auth/* endpoints used by settings pages. Token/login flows stay in
// api.ts's interceptor + the auth store; this is the profile/password surface.
import api from "./api";

export class AuthService {
  constructor(private http = api) {}

  me(): Promise<any> {
    return this.http.get("/auth/me").then((r) => r.data);
  }

  updateProfile(body: { full_name?: string; email?: string }): Promise<any> {
    return this.http.put("/auth/me", body).then((r) => r.data);
  }

  changePassword(currentPassword: string, newPassword: string): Promise<any> {
    return this.http
      .post("/auth/change-password", { current_password: currentPassword, new_password: newPassword })
      .then((r) => r.data);
  }
}

export const authService = new AuthService();
