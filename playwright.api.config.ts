import { defineConfig } from "@playwright/test";

const e2eDatabaseUrl = process.env.E2E_DATABASE_URL;
if (!e2eDatabaseUrl) {
  throw new Error(
    "E2E_DATABASE_URL is required and its database name must contain 'e2e'. " +
      "The API suite intentionally refuses to use the normal application database.",
  );
}
// CI installs the backend into the runner's own interpreter and sets
// E2E_PYTHON=python; locally the backend venv is used.
const python =
  process.env.E2E_PYTHON ??
  (process.platform === "win32" ? ".venv\\Scripts\\python.exe" : ".venv/bin/python");

/**
 * API-level e2e config for the OOP refactor. Runs only the `api-*.spec.ts`
 * suites and auto-starts a clean backend on :8001. The launcher drops and
 * recreates only an explicitly named E2E database, migrates it, and seeds the
 * fixed accounts used by the contract suite.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: /api-.*\.spec\.ts/,
  timeout: 30_000,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  globalTeardown: "./e2e/api-global-teardown.ts",
  // 127.0.0.1, not localhost: the launcher binds IPv4 only, and localhost can
  // resolve to ::1 first (notably on GitHub runners).
  use: {
    baseURL: "http://127.0.0.1:8001",
  },
  webServer: {
    command: `${python} start_disposable_e2e.py`,
    cwd: "backend",
    url: "http://127.0.0.1:8001/api/health",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
