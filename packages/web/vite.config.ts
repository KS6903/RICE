import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The dev server's port and the backend its /api proxy forwards to. Defaults
// are the everyday local stack; the browser e2e suite runs its own pair (a
// second dev server in front of a disposable backend) beside it.
const devPort = Number(process.env.WEB_DEV_PORT ?? 8448);
const apiProxyTarget = process.env.API_PROXY_TARGET ?? "http://localhost:8000";

// ── Content-Security-Policy ──────────────────────────────────────────────────
// The browser-side XSS defence (the backend's CSP only covers API responses).
// The production build emits only EXTERNAL scripts, so script-src stays strict
// ('self' + Google Identity Services) — no 'unsafe-inline'/'unsafe-eval', which
// blocks injected <script> tags and inline handlers. Dev relaxes script-src for
// Vite's HMR (eval + inline) only.
//
// Allowances: Google Fonts (googleapis/gstatic), Google login (accounts.google.com),
// the canvas WebSocket (ws:/wss:), and the dev backend on :8000. A desktop build
// (ORAIZA_API_ORIGIN, set by packages/desktop/scripts/build-desktop.mjs) adds its
// API's socket: its renderer runs at app://oraiza and opens the socket there.
const desktopSocket = process.env.ORAIZA_API_ORIGIN
  ? [new URL(process.env.ORAIZA_API_ORIGIN).origin.replace(/^http/, "ws")]
  : [];

function cspDirectives(dev: boolean, forHeader: boolean): Record<string, string[]> {
  const d: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": [
      "'self'",
      "https://accounts.google.com",
      // Cloudflare Turnstile, the sign-up form's bot check: its script, and below
      // its challenge iframe. Blocked, the widget never draws and sign-up can't
      // be sent.
      "https://challenges.cloudflare.com",
      ...(dev ? ["'unsafe-inline'", "'unsafe-eval'"] : []),
    ],
    "script-src-attr": ["'none'"],
    "style-src": [
      "'self'",
      "'unsafe-inline'",
      "https://fonts.googleapis.com",
      "https://accounts.google.com",
    ],
    "font-src": ["'self'", "data:", "https://fonts.gstatic.com"],
    "img-src": ["'self'", "data:", "https://accounts.google.com", "https://*.gstatic.com"],
    "connect-src": [
      "'self'",
      "https://accounts.google.com",
      "http://localhost:8000",
      "http://127.0.0.1:8000",
      "ws://localhost:8000",
      "ws://127.0.0.1:8000",
      ...desktopSocket,
      ...(dev ? [`ws://localhost:${devPort}`, `ws://127.0.0.1:${devPort}`] : []),
    ],
    "frame-src": ["https://accounts.google.com", "https://challenges.cloudflare.com"],
    "child-src": ["'none'"],
    "worker-src": ["'self'"],
    "media-src": ["'none'"],
    "manifest-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
  };
  // frame-ancestors is ignored when delivered via <meta>; only emit it on the
  // header path (and the prod host should send it too).
  if (forHeader) d["frame-ancestors"] = ["'none'"];
  return d;
}

function cspString(dev: boolean, forHeader: boolean): string {
  return Object.entries(cspDirectives(dev, forHeader))
    .map(([k, v]) => `${k} ${v.join(" ")}`)
    .join("; ");
}

/** Inject the strict CSP as a <meta> tag at build time, so it ships in the
 *  artifact (static hosts and the Electron file:// load both honour it). Note:
 *  `frame-ancestors` is ignored in meta — the prod host should also send the
 *  policy (and X-Frame-Options) as a response header. */
function cspMetaPlugin(): Plugin {
  return {
    name: "inject-csp-meta",
    apply: "build",
    transformIndexHtml(html) {
      const meta = `<meta http-equiv="Content-Security-Policy" content="${cspString(false, false)}" />`;
      return html.replace("</title>", `</title>\n    ${meta}`);
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    cspMetaPlugin(),
    VitePWA({
      registerType: "autoUpdate",
      // Registered from src/main.tsx, on http(s) pages only: the desktop app runs
      // at app://oraiza, where a service worker can't register (the injected
      // script's rejection went uncaught) and isn't wanted (it syncs via SQLite).
      injectRegister: false,
      manifest: {
        name: "Rice Mill System",
        short_name: "RiceMill",
        theme_color: "#16a34a",
        background_color: "#ffffff",
        display: "standalone",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
        ],
      },
      workbox: {
        // autoUpdate turns these on only when injectRegister is "auto", and it
        // is false here. Without them a new deploy's service worker waits until
        // every tab of the site is closed, and the tabs keep running the old
        // build (an old sign-up form sent no Turnstile token and was refused).
        skipWaiting: true,
        clientsClaim: true,
        // Pages come from the network, so a visit after a deploy runs the new
        // build at once. Served from the cache first, the old build showed for a
        // moment and was then swapped out (the sign-up form's invite field
        // appeared and vanished). The precached app shell is the fallback when
        // the network fails, so the app still opens offline, with the assets
        // precached alongside it. (A timeout would need NetworkFirst, which only
        // falls back to pages it has cached itself.) Nothing here caches a page: a
        // stale copy would point at assets the next deploy deletes, and Cloudflare
        // Access's sign-in redirect must never be stored as one. "/" must not
        // match the precached index.html either, hence directoryIndex: null.
        navigateFallback: null,
        directoryIndex: null,
        runtimeCaching: [
          {
            urlPattern: ({ request, url }) =>
              request.mode === "navigate" && !url.pathname.startsWith("/api/"),
            handler: "NetworkOnly",
            options: {
              precacheFallback: { fallbackURL: "index.html" },
            },
          },
        ],
        globPatterns: ["**/*.{js,css,html,ico,png,svg}"],
        // The existing high-resolution brand asset is ~2.7 MiB.
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
      },
    }),
  ],
  resolve: {
    alias: {
      "@rice-mill/shared": path.resolve(__dirname, "../shared/src/index.ts"),
    },
  },
  server: {
    port: devPort,
    strictPort: true,
    // Dev gets a (looser) CSP too, so HMR works and the e2e suite exercises the
    // policy against real flows (login, canvas WS, Google button, fonts).
    headers: {
      "Content-Security-Policy": cspString(true, true),
    },
    proxy: {
      "/api": apiProxyTarget,
    },
  },
});
