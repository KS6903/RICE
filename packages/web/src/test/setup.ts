// Vitest setup: registers jest-dom matchers (toBeInTheDocument, etc.) and clears
// the DOM between tests. Loaded via vitest.config.ts setupFiles.
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// jsdom has no matchMedia, and the theme store calls it at import time to pick
// the system theme. Answer "no match": light theme, motion allowed.
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

afterEach(() => {
  cleanup();
});
