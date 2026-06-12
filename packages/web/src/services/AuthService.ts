// AuthService — typed API client for account self-service (Phase F).
// Wraps the /auth/* endpoints used by settings pages. Token/login flows stay in
// api.ts's interceptor + the auth store; this is the profile/password surface.
import api from "./api";

export class AuthService {
  constructor(private http = api) {}

  me(): Promise<any> {
    return this.http.get("/auth/me").then((r) => r.data);
  }

  /** OAuth2 password-grant login. Returns the token pair; the caller stores it
   *  (via the auth store) before fetching `me()`. */
  login(username: string, password: string): Promise<any> {
    const form = new FormData();
    form.append("username", username);
    form.append("password", password);
    return this.http
      .post("/auth/login", form, { headers: { "Content-Type": "application/x-www-form-urlencoded" } })
      .then((r) => r.data);
  }

  loginGoogle(credential: string, extra?: Record<string, unknown>): Promise<any> {
    return this.http.post("/auth/google", { credential, ...extra }).then((r) => r.data);
  }

  signup(body: Record<string, unknown>): Promise<any> {
    return this.http.post("/auth/signup", body).then((r) => r.data);
  }

  updateProfile(body: { full_name?: string; email?: string }): Promise<any> {
    return this.http.put("/auth/me", body).then((r) => r.data);
  }

  changePassword(currentPassword: string, newPassword: string): Promise<any> {
    return this.http
      .post("/auth/change-password", { current_password: currentPassword, new_password: newPassword })
      .then((r) => r.data);
  }

  // ── MFA (TOTP) ──────────────────────────────────────────────────────────────

  /** Second login step when login() returned { mfa_required, challenge_token }. */
  mfaVerify(challengeToken: string, code: string): Promise<any> {
    return this.http
      .post("/auth/mfa/verify", { challenge_token: challengeToken, code })
      .then((r) => r.data);
  }

  mfaEnroll(): Promise<{ secret: string; otpauth_uri: string }> {
    return this.http.post("/auth/mfa/enroll").then((r) => r.data);
  }

  mfaEnrollVerify(code: string): Promise<any> {
    return this.http.post("/auth/mfa/enroll/verify", { code }).then((r) => r.data);
  }

  mfaDisable(code: string): Promise<any> {
    return this.http.post("/auth/mfa/disable", { code }).then((r) => r.data);
  }
}

export const authService = new AuthService();
