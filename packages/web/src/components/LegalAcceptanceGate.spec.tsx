import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
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

  it("keeps Accept disabled until the acceptance box is ticked", () => {
    draw();
    const accept = screen.getByRole("button", { name: /accept and continue/i });
    expect(accept).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /i have read and accept/i }));
    expect(accept).toBeEnabled();
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
