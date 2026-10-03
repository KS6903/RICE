import { defineConfig } from "vitest/config";

// Unit tests for the main process's Electron-free modules (config, app://
// routing, sync isolation and contract). They live in test/, outside
// tsconfig.json's include, so they're never compiled into the packaged app.
export default defineConfig({
  // The sources, not stale builds: tsc writes main/*.js beside main/*.ts, and
  // Vite would otherwise resolve "../main/x" to the compiled file first.
  resolve: { extensions: [".ts", ".mjs", ".js", ".json"] },
  test: {
    environment: "node",
    include: ["test/**/*.spec.ts"],
  },
});
