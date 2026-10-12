import { defineConfig, devices } from "@playwright/test";

/**
 * Browser end-to-end suite. Playwright starts its own stack, beside the
 * everyday one (:8448 → :8000), and never touches the development database:
 *
 *   - a disposable backend on :8001 (backend/start_disposable_e2e.py drops,
 *     migrates and seeds a database whose name must contain "e2e");
 *   - a second web dev server on :8449 whose /api proxy points at it.
 *
 * The "setup" project then records a little stock through the API (see
 * e2e/stock.setup.ts) before the browser tests run.
 *
 * E2E_REUSE=1 reuses a stack you started yourself (handy while writing tests);
 * otherwise E2E_DATABASE_URL is required, exactly as for the API suite.
 */
const reuse = !!process.env.E2E_REUSE;
if (!reuse && !process.env.E2E_DATABASE_URL) {
  throw new Error(
    "E2E_DATABASE_URL is required and its database name must contain 'e2e'. " +
      "The browser suite intentionally refuses to use the normal application database.",
  );
}
// CI installs the backend into the runner's own interpreter and sets
// E2E_PYTHON=python; locally the backend venv is used.
const python =
  process.env.E2E_PYTHON ??
  (process.platform === "win32" ? ".venv\\Scripts\\python.exe" : ".venv/bin/python");

const API = "http://127.0.0.1:8001";
const WEB_PORT = 8449;
const WEB = `http://127.0.0.1:${WEB_PORT}`;

export default defineConfig({
  testDir: "./e2e",
  // The request-level suite has its own config (playwright.api.config.ts).
  testIgnore: /api-.*\.spec\.ts/,
  // Generous: a cold dev server compiles each page on first visit.
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: 0,
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never" }], ["github"]]
    : [["list"], ["html", { open: "never" }]],
  // Stops the disposable backend (needed on Windows, where Playwright can't).
  globalTeardown: reuse ? undefined : "./e2e/api-global-teardown.ts",
  use: {
    baseURL: WEB,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /.*\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["setup"],
    },
  ],
  webServer: [
    {
      command: `${python} start_disposable_e2e.py`,
      cwd: "backend",
      url: `${API}/api/health`,
      reuseExistingServer: reuse,
      // Migrating and provisioning the tenant from scratch takes a while on a
      // cold machine.
      timeout: 300_000,
    },
    {
      command: "npx vite --host 127.0.0.1",
      cwd: "packages/web",
      env: { WEB_DEV_PORT: String(WEB_PORT), API_PROXY_TARGET: API },
      url: WEB,
      reuseExistingServer: reuse,
      timeout: 120_000,
    },
  ],
});
