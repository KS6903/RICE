// AuthService — typed API client for account self-service (Phase F).
// Wraps the /auth/* endpoints used by settings pages. Token/login flows stay in
// api.ts's interceptor + the auth store; this is the profile/password surface.
import api from "./api";

export type UpdateProfileRequest = {
  full_name?: string;
  email?: string;
  current_password?: string;
  mfa_code?: string;
};

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
      .post("/auth/login", form, {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      })
      .then((r) => r.data);
  }

  loginGoogle(credential: string, extra?: Record<string, unknown>): Promise<any> {
    return this.http.post("/auth/google", { credential, ...extra }).then((r) => r.data);
  }

  linkGoogle(
    credential: string,
    proof: { current_password?: string; mfa_code?: string },
  ): Promise<{ message: string }> {
    return this.http.post("/auth/google/link", { credential, ...proof }).then((r) => r.data);
  }

  unlinkGoogle(proof: {
    current_password?: string;
    mfa_code?: string;
  }): Promise<{ message: string }> {
    return this.http.post("/auth/google/unlink", proof).then((r) => r.data);
  }

  signup(body: Record<string, unknown>): Promise<any> {
    return this.http.post("/auth/signup", body).then((r) => r.data);
  }

  updateProfile(body: UpdateProfileRequest): Promise<any> {
    return this.http.put("/auth/me", body).then((r) => r.data);
  }

  /** A locked-out Boss asks the platform admin for a temporary password. The answer
   *  is the same whoever the username is, so it can't be used to find accounts. */
  requestLockoutHelp(username: string, message?: string): Promise<{ message: string }> {
    return this.http
      .post("/auth/lockout-help", { username, message: message || undefined })
      .then((r) => r.data);
  }

  changePassword(currentPassword: string, newPassword: string): Promise<any> {
    return this.http
      .post("/auth/change-password", {
        current_password: currentPassword,
        new_password: newPassword,
      })
      .then((r) => r.data);
  }

  // ── Password reset ──────────────────────────────────────────────────────────

  /** Request a reset link. Always resolves the same way (no account enumeration). */
  forgotPassword(identifier: string): Promise<{ message: string; reset_token?: string }> {
    return this.http.post("/auth/forgot-password", { identifier }).then((r) => r.data);
  }

  resetPassword(token: string, newPassword: string): Promise<any> {
    return this.http
      .post("/auth/reset-password", { token, new_password: newPassword })
      .then((r) => r.data);
  }

  // ── Email verification ──────────────────────────────────────────────────────

  verifyEmail(token: string): Promise<any> {
    return this.http.post("/auth/verify-email", { token }).then((r) => r.data);
  }

  resendVerification(): Promise<any> {
    return this.http.post("/auth/resend-verification").then((r) => r.data);
  }

  // ── MFA (TOTP) ──────────────────────────────────────────────────────────────

  /** Second login step when login() returned { mfa_required, challenge_token }.
   *  Sends the browser's time zone, so this device's weekly 2FA re-prompt lands
   *  on Sunday in the user's own local time. */
  mfaVerify(challengeToken: string, code: string): Promise<any> {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return this.http
      .post("/auth/mfa/verify", { challenge_token: challengeToken, code, timezone })
      .then((r) => r.data);
  }

  mfaEnroll(): Promise<{ secret: string; otpauth_uri: string }> {
    return this.http.post("/auth/mfa/enroll").then((r) => r.data);
  }

  /** Confirms enrollment; returns the one-time backup codes to show the user. */
  mfaEnrollVerify(code: string): Promise<{ message: string; backup_codes: string[] }> {
    return this.http.post("/auth/mfa/enroll/verify", { code }).then((r) => r.data);
  }

  /** Turning 2FA off takes both factors: a current authenticator code and the password. */
  mfaDisable(code: string, password: string): Promise<any> {
    return this.http.post("/auth/mfa/disable", { code, password }).then((r) => r.data);
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
