import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import LegalAcceptanceGate from "./LegalAcceptanceGate";

const draw = () =>
  render(
    <MemoryRouter>
      <LegalAcceptanceGate />
    </MemoryRouter>,
  );

describe("LegalAcceptanceGate", () => {
  it("links once, to the single page that holds every document", () => {
    const { container } = draw();
    const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["/legal"]);
    expect(screen.getByRole("link", { name: /terms and policies/i })).toBeInTheDocument();
  });

  it("has no acknowledgement checkbox; the Accept button works on its own", () => {
    const { container } = draw();
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
    expect(screen.getByRole("button", { name: /accept and continue/i })).toBeEnabled();
  });

  it("keeps glass off the animated background", () => {
    // The brand gradient animates here by choice. Glass on top of it would
    // re-blur the moving background every frame, so the card stays solid.
    const { container } = draw();
    for (const cls of ["glass", "card", "panel"]) {
      expect(container.innerHTML).not.toContain(cls);
    }
  });
});
