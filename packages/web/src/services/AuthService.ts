// AuthService — typed API client for account self-service (Phase F).
// Wraps the /auth/* endpoints used by settings pages. Token/login flows stay in
// api.ts's interceptor + the auth store; this is the profile/password surface.
import type { AccountState } from "@rice-mill/shared";
import api from "./api";

export type UpdateProfileRequest = {
  full_name?: string;
  email?: string;
  current_password?: string;
  mfa_code?: string;
};

/** What stands between the mill and closing its account: each thing still
 *  open with Oraiza. */
export type AccountClosure = AccountState & {
  company_name: string;
  export_window_days: number;
  blockers: { code: "plan_request" | "unpaid" | "paid_time"; message: string }[];
};

/** A cookie a signed-in browser keeps for one session (Settings > Devices). */
export type SessionCookie = {
  name: string;
  purpose: string;
  /** How long it lasts when it renews itself, e.g. "15 minutes, renewed while you use the app". */
  lasts: string | null;
  expires_at: string | null;
  http_only: boolean;
  secure: boolean;
  same_site: string;
  path: string;
};

/** One signed-in device. Sessions from before device details were kept have
 *  no user_agent or IP. */
export type DeviceSession = {
  id: string;
  client: string;
  device_type: "Phone" | "Tablet" | "Computer" | "Desktop app" | "Unknown";
  device_name: string | null;
  browser: string | null;
  os: string | null;
  user_agent: string | null;
  ip_address: string | null;
  signed_in_ip: string | null;
  signed_in_at: string;
  last_active: string;
  expires_at: string;
  current: boolean;
  cookies: SessionCookie[];
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

  /** Whether sign-up needs an invite code, and the Turnstile site key (null when off). */
  signupConfig(): Promise<{ invite_required: boolean; turnstile_site_key: string | null }> {
    return this.http.get("/auth/signup-config").then((r) => r.data);
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

  /** Where the branch picker opens, on every device: "main", "all", or a branch id. */
  setBranchView(view: string): Promise<{ branch_view_default: string }> {
    return this.http.put("/auth/branch-view", { view }).then((r) => r.data);
  }

  /** Show the app in this language on every device this account signs in on. */
  setLanguage(language: string): Promise<{ language: string | null }> {
    return this.http.put("/auth/language", { language }).then((r) => r.data);
  }

  // ── Closing the mill's account (the Boss) ───────────────────────────────────

  /** The account's state, and what (if anything) stops it closing now. */
  accountClosure(): Promise<AccountClosure> {
    return this.http.get("/auth/account/closure").then((r) => r.data);
  }

  /** Pause the account, or ask for it to be deleted. Signs everyone out. */
  closeAccount(body: {
    mode: "pause" | "delete";
    current_password: string;
    mfa_code?: string;
    confirm_name?: string;
  }): Promise<AccountState> {
    return this.http.post("/auth/account/close", body).then((r) => r.data);
  }

  /** Switch a paused account back on, or take back a deletion request. */
  reopenAccount(): Promise<AccountState> {
    return this.http.post("/auth/account/reopen").then((r) => r.data);
  }

  // ── Active sessions / devices ───────────────────────────────────────────────

  sessions(): Promise<DeviceSession[]> {
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
