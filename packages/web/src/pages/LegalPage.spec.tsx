import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import LegalPage from "./LegalPage";
import { legalService, type LegalDocument } from "../services/LegalService";

const doc = (key: string, title: string, body: string): LegalDocument => ({
  key,
  title,
  version: "1.0",
  effective_date: "2026-01-01",
  summary: `${title} summary`,
  in_bundle: true,
  sha256: `hash-${key}`,
  markdown: `# ${title}\n\n## 1. Definitions\n\n${body}\n`,
});

const DOCS = [
  doc("terms", "Terms of Service", "Terms body."),
  doc("aup", "Acceptable Use Policy", "AUP body."),
];

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
    const found = DOCS.find((d) => d.key === key);
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
    expect(screen.getByText("AUP body.")).toBeInTheDocument();
    expect(container.querySelector("section#terms")).toBeTruthy();
    expect(container.querySelector("section#aup")).toBeTruthy();
  });

  it("shows the Oryza product logo in the header", async () => {
    const { container } = draw("/legal");
    await screen.findByText("Terms body.");
    expect(container.querySelector('header img[alt="Oryza"]')).toBeTruthy();
  });

  it("keeps heading ids unique across documents", async () => {
    // Both documents have a "1. Definitions" heading.
    const { container } = draw("/legal");
    await screen.findByText("Terms body.");
    expect(container.querySelector("#terms-1-definitions")).toBeTruthy();
    expect(container.querySelector("#aup-1-definitions")).toBeTruthy();
  });

  it("renders the whole page for a per-document link, scrolled to that document", async () => {
    // /legal/aup is linked from signup and emails; it must still work.
    draw("/legal/aup");
    expect(await screen.findByText("AUP body.")).toBeInTheDocument();
    expect(screen.getByText("Terms body.")).toBeInTheDocument();
    const scroll = vi.mocked(Element.prototype.scrollIntoView);
    expect(scroll).toHaveBeenCalled();
    expect((scroll.mock.contexts.at(-1) as Element).id).toBe("aup");
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
