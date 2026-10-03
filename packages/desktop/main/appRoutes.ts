// What app://oryza/<path> means: the web bundle's files, the SPA's routes, or
// the API. No Electron imports, so the rules are testable on their own.
import fs from "fs";
import path from "path";

export const APP_SCHEME = "app";
export const APP_HOST = "oryza";
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;
export const CLIENT_VERSION_HEADER = "X-Client-Version";

export function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

/**
 * The file to serve for a path: the bundle's file when it exists, else
 * index.html, so the SPA's own routes load (as the web host does). Nothing
 * outside the bundle, whatever the path says.
 */
export function staticFile(webRoot: string, pathname: string): string {
  const index = path.join(webRoot, "index.html");
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return index;
  }
  if (decoded.includes("\0")) return index;
  const candidate = path.resolve(webRoot, `.${path.posix.normalize(decoded)}`);
  const relative = path.relative(webRoot, candidate);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return index;
  try {
    return fs.statSync(candidate).isFile() ? candidate : index;
  } catch {
    return index;
  }
}

/** Where an app://oryza/api/... request goes. */
export function apiTarget(apiOrigin: string, url: URL): string {
  return new URL(`${url.pathname}${url.search}`, apiOrigin).toString();
}

/**
 * The headers forwarded to the API: the renderer's, minus what describes the
 * app:// page rather than the request (and would only confuse the API's
 * origin and cookie checks), plus this build's version.
 */
export function forwardedHeaders(incoming: Headers, appVersion: string): Headers {
  const headers = new Headers(incoming);
  for (const name of ["origin", "referer", "cookie", "host"]) headers.delete(name);
  headers.set(CLIENT_VERSION_HEADER, appVersion);
  return headers;
}
