// Vitest setup: registers jest-dom matchers (toBeInTheDocument, etc.) and clears
// the DOM between tests. Loaded via vitest.config.ts setupFiles.
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});
