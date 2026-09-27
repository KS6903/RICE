const recentCaptures = new Map<string, string>();

function hashParameters(url: URL): URLSearchParams | null {
  const raw = url.hash.replace(/^#\??/, "");
  if (!raw || (!raw.includes("=") && !raw.includes("&"))) return null;
  return new URLSearchParams(raw);
}

/**
 * Read a one-time secret from a fragment (preferred) or legacy query string,
 * then immediately replace the address-bar entry without that secret.
 */
export function consumeSensitiveUrlToken(name = "token"): string {
  if (typeof window === "undefined") return "";

  const url = new URL(window.location.href);
  const captureKey = `${url.pathname}:${name}`;
  const fragment = hashParameters(url);
  const token = fragment?.get(name) ?? url.searchParams.get(name) ?? "";

  if (!token) return recentCaptures.get(captureKey) ?? "";

  url.searchParams.delete(name);
  if (fragment?.has(name)) {
    fragment.delete(name);
    const remaining = fragment.toString();
    url.hash = remaining ? `#${remaining}` : "";
  }

  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);

  // React StrictMode may evaluate a state initializer twice. Keep the value for
  // that synchronous replay only, never in browser storage or history state.
  recentCaptures.set(captureKey, token);
  queueMicrotask(() => {
    if (recentCaptures.get(captureKey) === token) recentCaptures.delete(captureKey);
  });
  return token;
}
