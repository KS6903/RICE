import { defineConfig } from "vitest/config";

// Unit tests for the main process's Electron-free modules (config, app://
// routing, sync isolation and contract). They live in test/, outside
// tsconfig.json's include, so they're never compiled into the packaged app.
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.spec.ts"],
  },
});
