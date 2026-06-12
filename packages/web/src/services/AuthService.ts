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

  // ── Password reset ──────────────────────────────────────────────────────────

  /** Request a reset link. Always resolves the same way (no account enumeration). */
  forgotPassword(identifier: string): Promise<{ message: string; reset_token?: string }> {
    return this.http.post("/auth/forgot-password", { identifier }).then((r) => r.data);
  }

  resetPassword(token: string, newPassword: string): Promise<any> {
    return this.http.post("/auth/reset-password", { token, new_password: newPassword }).then((r) => r.data);
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

  /** Confirms enrollment; returns the one-time backup codes to show the user. */
  mfaEnrollVerify(code: string): Promise<{ message: string; backup_codes: string[] }> {
    return this.http.post("/auth/mfa/enroll/verify", { code }).then((r) => r.data);
  }

  mfaDisable(code: string): Promise<any> {
    return this.http.post("/auth/mfa/disable", { code }).then((r) => r.data);
  }

  /** Issues a fresh set of backup codes (invalidates the old set). Needs a TOTP. */
  regenerateBackupCodes(code: string): Promise<{ backup_codes: string[] }> {
    return this.http.post("/auth/mfa/backup-codes/regenerate", { code }).then((r) => r.data);
  }

  // ── Active sessions / devices ───────────────────────────────────────────────

  sessions(): Promise<
    { id: string; client: string; last_active: string; expires_at: string; current: boolean }[]
  > {
    return this.http.get("/auth/sessions").then((r) => r.data);
  }

  revokeSession(id: string): Promise<any> {
    return this.http.delete(`/auth/sessions/${id}`).then((r) => r.data);
  }

  revokeOtherSessions(): Promise<{ revoked: number }> {
    return this.http.post("/auth/sessions/revoke-others").then((r) => r.data);
  }
}

export const authService = new AuthService();
