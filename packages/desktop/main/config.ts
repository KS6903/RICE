// Where this build talks to, fixed when it's packaged.
//
// scripts/build-desktop.mjs writes main/build-config.json from ORYZA_API_ORIGIN
// (and whether this build updates itself). A development run has no such file
// and talks to the local API. Nothing here imports Electron, so it's testable.
import fs from "fs";
import path from "path";

export interface DesktopConfig {
  /** The API's origin, e.g. https://app.example.com: no path, no trailing slash. */
  apiOrigin: string;
  /** Whether this build checks for and installs signed updates. */
  updates: boolean;
}

export const DEV_CONFIG: DesktopConfig = { apiOrigin: "http://localhost:8000", updates: false };

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** A validated config, or an error saying what's wrong with it. */
export function parseConfig(raw: unknown, { packaged }: { packaged: boolean }): DesktopConfig {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("build config must be an object");
  }
  const value = raw as Record<string, unknown>;
  if (typeof value.apiOrigin !== "string") throw new Error("build config needs apiOrigin");
  let url: URL;
  try {
    url = new URL(value.apiOrigin);
  } catch {
    throw new Error("apiOrigin is not a URL");
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("apiOrigin must be an origin only, like https://app.example.com");
  }
  const local = LOCAL_HOSTS.has(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local && !packaged)) {
    // A packaged build carries bearer tokens and business data: never in clear text.
    throw new Error("apiOrigin must use https");
  }
  return { apiOrigin: url.origin, updates: value.updates === true };
}

/** The packaged build's config; the development defaults when unpackaged. */
export function loadConfig({ packaged, dir }: { packaged: boolean; dir: string }): DesktopConfig {
  const file = path.join(dir, "build-config.json");
  if (!fs.existsSync(file)) {
    if (packaged) throw new Error("This build is missing its build-config.json");
    return DEV_CONFIG;
  }
  return parseConfig(JSON.parse(fs.readFileSync(file, "utf8")), { packaged });
}
