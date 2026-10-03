import axios from "axios";
import { SyncIdentity } from "../sync/contract";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SCHEMA_RE = /^client_[a-f0-9]{32}$/;
const ROLES = new Set(["owner", "admin", "accountant", "cashier", "mill_operator", "encoder"]);
const MAX_TOKEN_LENGTH = 8_192;

interface AccessClaims {
  sub: string;
  company_id: string;
  schema: string;
  role: string;
  type: "access";
  exp: number;
  is_platform_admin?: boolean;
}

interface MeResponse {
  id?: unknown;
  company_id?: unknown;
  role?: unknown;
  is_platform_admin?: unknown;
  features?: unknown;
}

function decodePayload(token: string): unknown {
  if (!token || token.length > MAX_TOKEN_LENGTH) throw new Error("Invalid access token");
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((part) => !part)) throw new Error("Invalid access token");
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    throw new Error("Invalid access token");
  }
}

/**
 * Validate the claims used to choose a local tenant database. Signature trust is
 * established separately by validateTokenWithServer before a renderer-provided
 * token is accepted.
 */
export function identityFromToken(token: string): SyncIdentity {
  const value = decodePayload(token);
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("Invalid access token");
  const claims = value as Partial<AccessClaims>;
  if (
    claims.type !== "access" ||
    claims.is_platform_admin === true ||
    typeof claims.sub !== "string" ||
    !UUID_RE.test(claims.sub) ||
    typeof claims.company_id !== "string" ||
    !UUID_RE.test(claims.company_id) ||
    typeof claims.schema !== "string" ||
    !SCHEMA_RE.test(claims.schema) ||
    typeof claims.role !== "string" ||
    !ROLES.has(claims.role) ||
    typeof claims.exp !== "number" ||
    !Number.isFinite(claims.exp) ||
    claims.exp * 1000 <= Date.now()
  ) {
    throw new Error("Invalid or expired desktop access token");
  }
  return {
    userId: claims.sub,
    companyId: claims.company_id,
    schema: claims.schema,
    role: claims.role,
  };
}

export async function validateTokenWithServer(
  token: string,
  apiBase: string,
  appVersion: string,
): Promise<SyncIdentity> {
  const identity = identityFromToken(token);
  const response = await axios.get<MeResponse>(`${apiBase}/auth/me`, {
    headers: { Authorization: `Bearer ${token}`, "X-Client-Version": appVersion },
    timeout: 10_000,
    maxContentLength: 128 * 1024,
  });
  const me = response.data;
  const features = Array.isArray(me.features) ? me.features : [];
  if (
    me.id !== identity.userId ||
    me.company_id !== identity.companyId ||
    me.role !== identity.role ||
    me.is_platform_admin === true ||
    !features.includes("offline_sync")
  ) {
    throw new Error("Desktop sync identity or entitlement mismatch");
  }
  return identity;
}

export function sameIdentity(left: SyncIdentity, right: SyncIdentity): boolean {
  return (
    left.userId === right.userId &&
    left.companyId === right.companyId &&
    left.schema === right.schema &&
    left.role === right.role
  );
}
