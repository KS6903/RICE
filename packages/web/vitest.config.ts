/// <reference types="vitest" />
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));

// Dedicated Vitest config (kept separate from vite.config.ts so the PWA plugin
// and dev-server settings don't run under tests). Added in Phase 0 of the OOP
// refactor to enable unit testing of the upcoming service/mapper layer.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@rice-mill/shared": path.resolve(dir, "../shared/src/index.ts"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    // Vitest's 5 s default is too tight for the slowest page tests on the
    // self-hosted CI runner (LoginPage and Tour took 5.2 s and 6.4 s there);
    // 20 s leaves room on a busy machine and still catches a test that hangs.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
