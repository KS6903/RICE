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
  },
});
