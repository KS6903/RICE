// The packaged app runs at app://oraiza, not file://.
//
// file:// gave the web app nowhere to send "/api" requests, and an opaque
// origin the API could only accept by trusting every sandboxed page on the
// web. Instead the main process serves the bundle on its own secure scheme and
// forwards app://oraiza/api/... to the configured API itself: the renderer stays
// same-origin, the API address lives in one build-time setting, and the API
// sees an ordinary client carrying this build's version.
import { net, protocol } from "electron";
import { pathToFileURL } from "url";
import {
  APP_SCHEME,
  apiTarget,
  forwardedHeaders,
  isApiPath,
  isAppUrl,
  MFA_TRUST_HEADER,
  sendsMfaTrust,
  staticFile,
} from "./appRoutes";
import { MfaTrustJar } from "./security/mfaTrust";

/** Must run before the app is ready. */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true },
    },
  ]);
}

export interface AppProtocolOptions {
  webRoot: string;
  apiOrigin: string;
  appVersion: string;
  /** The API answered 426: this build is too old. */
  onUpgradeRequired: () => void;
  /** The weekly 2FA trust this device holds, per account. */
  mfaTrust: Pick<MfaTrustJar, "header" | "add">;
}

export function serveApp(options: AppProtocolOptions): void {
  protocol.handle(APP_SCHEME, (request) => respond(request, options));
}

async function respond(request: Request, options: AppProtocolOptions): Promise<Response> {
  const url = new URL(request.url);
  if (!isAppUrl(url)) return new Response(null, { status: 404 });
  if (isApiPath(url.pathname)) return forward(request, url, options);
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(null, { status: 405 });
  }
  return net.fetch(pathToFileURL(staticFile(options.webRoot, url.pathname)).toString());
}

async function forward(request: Request, url: URL, options: AppProtocolOptions): Promise<Response> {
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const headers = forwardedHeaders(request.headers, options.appVersion);
  const trust = sendsMfaTrust(url.pathname) ? options.mfaTrust.header() : null;
  if (trust) headers.set(MFA_TRUST_HEADER, trust);
  const init: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers,
    credentials: "omit",
    ...(hasBody ? { body: request.body, duplex: "half" } : {}),
  };
  try {
    const response = await net.fetch(apiTarget(options.apiOrigin, url), init);
    if (response.status === 426) options.onUpgradeRequired();
    return keepMfaTrust(response, options.mfaTrust);
  } catch {
    // Offline or unreachable: what a browser's failed request looks like to axios.
    return Response.error();
  }
}

/** A passed 2FA answers with this device's trust for the account: keep it here
 *  and pass the rest of the answer on without it. */
function keepMfaTrust(response: Response, jar: Pick<MfaTrustJar, "add">): Response {
  const token = response.headers.get(MFA_TRUST_HEADER);
  if (!token) return response;
  jar.add(token);
  const headers = new Headers(response.headers);
  headers.delete(MFA_TRUST_HEADER);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
