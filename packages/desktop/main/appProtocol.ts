// The packaged app runs at app://oryza, not file://.
//
// file:// gave the web app nowhere to send "/api" requests, and an opaque
// origin the API could only accept by trusting every sandboxed page on the
// web. Instead the main process serves the bundle on its own secure scheme and
// forwards app://oryza/api/... to the configured API itself: the renderer stays
// same-origin, the API address lives in one build-time setting, and the API
// sees an ordinary client carrying this build's version.
import { net, protocol } from "electron";
import { pathToFileURL } from "url";
import {
  APP_ORIGIN,
  APP_SCHEME,
  apiTarget,
  forwardedHeaders,
  isApiPath,
  staticFile,
} from "./appRoutes";

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
}

export function serveApp(options: AppProtocolOptions): void {
  protocol.handle(APP_SCHEME, (request) => respond(request, options));
}

async function respond(request: Request, options: AppProtocolOptions): Promise<Response> {
  const url = new URL(request.url);
  if (url.origin !== APP_ORIGIN) return new Response(null, { status: 404 });
  if (isApiPath(url.pathname)) return forward(request, url, options);
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(null, { status: 405 });
  }
  return net.fetch(pathToFileURL(staticFile(options.webRoot, url.pathname)).toString());
}

async function forward(request: Request, url: URL, options: AppProtocolOptions): Promise<Response> {
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const init: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers: forwardedHeaders(request.headers, options.appVersion),
    credentials: "omit",
    ...(hasBody ? { body: request.body, duplex: "half" } : {}),
  };
  try {
    const response = await net.fetch(apiTarget(options.apiOrigin, url), init);
    if (response.status === 426) options.onUpgradeRequired();
    return response;
  } catch {
    // Offline or unreachable: what a browser's failed request looks like to axios.
    return Response.error();
  }
}
