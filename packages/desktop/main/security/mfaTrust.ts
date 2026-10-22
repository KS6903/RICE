// "Remember this device" for 2FA, on the desktop.
//
// In a browser the API keeps each account's weekly 2FA trust in an httpOnly
// cookie. The desktop app's API calls go through the main process without
// cookies (appProtocol.ts), so the main process keeps the trust tokens instead:
// it takes them off the 2FA answer before the page sees one, and hands them back
// on the next sign-in. Like the cookie, the page never holds them.

const MAX_TOKENS = 10;
const MAX_TOKEN_LENGTH = 4_096;

export interface MfaTrustStore {
  load(): string[];
  save(tokens: string[]): void;
}

interface TrustClaims {
  sub: string;
  exp: number;
}

/** The account and expiry a trust token names, read without checking its
 *  signature: the API does that. This only tells which tokens can still work
 *  and which account each is for. */
export function trustClaims(token: string): TrustClaims | null {
  if (!token || token.length > MAX_TOKEN_LENGTH) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((part) => !part)) return null;
  try {
    const claims: unknown = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    if (typeof claims !== "object" || claims === null) return null;
    const { sub, exp } = claims as Partial<TrustClaims>;
    if (typeof sub !== "string" || typeof exp !== "number" || !Number.isFinite(exp)) return null;
    return { sub, exp };
  } catch {
    return null;
  }
}

export class MfaTrustJar {
  private tokens: string[];

  constructor(
    private readonly store: MfaTrustStore,
    private readonly now: () => number = Date.now,
  ) {
    this.tokens = this.live(store.load());
  }

  /** The X-MFA-Trust value for a sign-in: every account's live token. */
  header(): string | null {
    this.tokens = this.live(this.tokens);
    return this.tokens.length > 0 ? this.tokens.join(", ") : null;
  }

  /** Keep a token the API just issued, in place of that account's older one. */
  add(token: string): void {
    const claims = trustClaims(token);
    if (!claims) return;
    const others = this.tokens.filter((kept) => trustClaims(kept)?.sub !== claims.sub);
    this.tokens = this.live([token, ...others]);
    this.store.save(this.tokens);
  }

  /** Well-formed, unexpired, newest first, at most MAX_TOKENS. */
  private live(tokens: string[]): string[] {
    const seconds = this.now() / 1000;
    return tokens
      .filter((token) => {
        const claims = typeof token === "string" ? trustClaims(token) : null;
        return claims !== null && claims.exp > seconds;
      })
      .slice(0, MAX_TOKENS);
  }
}
