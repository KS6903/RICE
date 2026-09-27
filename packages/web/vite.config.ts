import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Content-Security-Policy ──────────────────────────────────────────────────
// The browser-side XSS defence (the backend's CSP only covers API responses).
// The production build emits only EXTERNAL scripts, so script-src stays strict
// ('self' + Google Identity Services) — no 'unsafe-inline'/'unsafe-eval', which
// blocks injected <script> tags and inline handlers. Dev relaxes script-src for
// Vite's HMR (eval + inline) only.
//
// Allowances: Google Fonts (googleapis/gstatic), Google login (accounts.google.com),
// the canvas WebSocket (ws:/wss:), and the desktop/dev backend on :8000 so the
// same policy works for the Electron build (file://) and local dev.
function cspDirectives(dev: boolean, forHeader: boolean): Record<string, string[]> {
  const d: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": [
      "'self'",
      "https://accounts.google.com",
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
      ...(dev ? ["ws://localhost:8448", "ws://127.0.0.1:8448"] : []),
    ],
    "frame-src": ["https://accounts.google.com"],
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
    port: 8448,
    strictPort: true,
    // Dev gets a (looser) CSP too, so HMR works and the e2e suite exercises the
    // policy against real flows (login, canvas WS, Google button, fonts).
    headers: {
      "Content-Security-Policy": cspString(true, true),
    },
    proxy: {
      "/api": "http://localhost:8000",
    },
  },
});
