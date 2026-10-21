import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import LegalPage from "./LegalPage";
import { legalService, type LegalDocument } from "../services/LegalService";

const doc = (key: string, title: string, body: string, more = ""): LegalDocument => ({
  key,
  title,
  version: "1.0",
  effective_date: "2026-01-01",
  summary: `${title} summary`,
  in_bundle: true,
  sha256: `hash-${key}`,
  markdown: `# ${title}\n\n## 1. Definitions\n\n${body}\n${more}`,
});

const DOCS = [
  doc("terms", "Terms of Service", "Terms body.", "\n## 7. Acceptable use\n\nUse body.\n"),
  doc("privacy", "Privacy Policy", "Privacy body."),
];

// Served at its own key, but not in the index: it is the mill's to issue.
const UNLISTED = { ...doc("employee-notice", "Employee notice", "Notice body."), in_bundle: false };

// The page scrolls in an effect that runs after the documents render, so wait
// for the scroll itself: checking the moment the text appears raced the effect
// on a busy CI runner.
const scrolledTo = (id: string) =>
  waitFor(
    () => {
      const scroll = vi.mocked(Element.prototype.scrollIntoView);
      expect((scroll.mock.contexts.at(-1) as Element | undefined)?.id).toBe(id);
    },
    { timeout: 5000 },
  );

function draw(path: string) {
  // jsdom implements neither; the page calls both to jump between documents.
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  Element.prototype.scrollIntoView = vi.fn();
  vi.spyOn(legalService, "index").mockResolvedValue({
    agreement_version: "2026.1",
    bundle_hash: "bundle",
    documents: DOCS,
  });
  vi.spyOn(legalService, "document").mockImplementation(async (key) => {
    const found = [...DOCS, UNLISTED].find((d) => d.key === key);
    if (!found) throw new Error("not found");
    return found;
  });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/legal" element={<LegalPage />} />
        <Route path="/legal/:key" element={<LegalPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  delete (Element.prototype as Partial<Element>).scrollIntoView;
});

describe("LegalPage", () => {
  it("shows every document on one page", async () => {
    const { container } = draw("/legal");
    expect(await screen.findByText("Terms body.")).toBeInTheDocument();
    expect(screen.getByText("Privacy body.")).toBeInTheDocument();
    expect(container.querySelector("section#terms")).toBeTruthy();
    expect(container.querySelector("section#privacy")).toBeTruthy();
    expect(screen.queryByText("Notice body.")).toBeNull();
  });

  it("shows the Oraiza product logo in the header", async () => {
    const { container } = draw("/legal");
    await screen.findByText("Terms body.");
    expect(container.querySelector('header img[alt="Oraiza"]')).toBeTruthy();
  });

  it("keeps heading ids unique across documents", async () => {
    // Both documents have a "1. Definitions" heading.
    const { container } = draw("/legal");
    await screen.findByText("Terms body.");
    expect(container.querySelector("#terms-1-definitions")).toBeTruthy();
    expect(container.querySelector("#privacy-1-definitions")).toBeTruthy();
  });

  it("renders the whole page for a per-document link, scrolled to that document", async () => {
    // /legal/privacy is linked from signup and emails; it must still work.
    draw("/legal/privacy");
    expect(await screen.findByText("Privacy body.")).toBeInTheDocument();
    expect(screen.getByText("Terms body.")).toBeInTheDocument();
    await scrolledTo("privacy");
  });

  it("sends a link to a retired document to the section it became", async () => {
    // The Acceptable Use Policy is now section 7 of the Terms.
    draw("/legal/aup");
    expect(await screen.findByText("Use body.")).toBeInTheDocument();
    await scrolledTo("terms-7-acceptable-use");
    expect(vi.mocked(legalService.document)).not.toHaveBeenCalledWith("aup");
  });

  it("shows an unlisted document only when a link opens it", async () => {
    const { container } = draw("/legal/employee-notice");
    expect(await screen.findByText("Notice body.")).toBeInTheDocument();
    expect(screen.getByText("Terms body.")).toBeInTheDocument();
    expect(container.querySelector("section#employee-notice")).toBeTruthy();
    await scrolledTo("employee-notice");
  });

  it("uses no animated or glass surfaces", async () => {
    // These classes repaint or re-blur every frame; they made a page of static
    // text a constant GPU load.
    const { container } = draw("/legal");
    await screen.findByText("Terms body.");
    const html = container.innerHTML;
    for (const cls of ["bg-grad-brand-anim", "glass", "card", "panel", "skeleton", "animate-"]) {
      expect(html).not.toContain(cls);
    }
  });
});
