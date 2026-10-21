// Vitest setup: registers jest-dom matchers (toBeInTheDocument, etc.) and clears
// the DOM between tests. Loaded via vitest.config.ts setupFiles.
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup, configure } from "@testing-library/react";

// findBy*/waitFor give up after 1 s by default, which a loaded machine can miss
// before a page's first fetch settles (DataExport and LegalPage failed that way
// on the self-hosted CI runner). 5 s still fails fast inside the 20 s testTimeout.
configure({ asyncUtilTimeout: 5000 });

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
