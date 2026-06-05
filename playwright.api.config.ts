import { defineConfig } from "@playwright/test";

/**
 * API-level e2e config for the OOP refactor. Runs only the `api-*.spec.ts`
 * suites and auto-starts a CLEAN backend on :8001 (so we never depend on, or
 * disturb, a dev server already running on :8000). Each refactored phase is
 * validated end-to-end by running:  npm run test:e2e:api
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: /api-.*\.spec\.ts/,
  timeout: 30_000,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:8001",
  },
  webServer: {
    command: ".venv\\Scripts\\python.exe -m uvicorn app.main:app --port 8001 --no-access-log",
    cwd: "backend",
    url: "http://localhost:8001/api/health",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
