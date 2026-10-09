import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Markdown from "./Markdown";

const draw = (source: string) =>
  render(
    <MemoryRouter>
      <Markdown source={source} />
    </MemoryRouter>,
  );

describe("Markdown", () => {
  it("renders headings, paragraphs and bullets", () => {
    const { container } = draw(
      "# Terms of Service\n\nSome opening text.\n\n## 1. Definitions\n\n- first point\n- second point\n",
    );
    expect(screen.getByText("Terms of Service")).toBeInTheDocument();
    expect(screen.getByText("Some opening text.")).toBeInTheDocument();
    expect(screen.getByText("1. Definitions")).toBeInTheDocument();
    expect(container.querySelectorAll("li")).toHaveLength(2);
  });

  it("joins hard-wrapped lines into one paragraph", () => {
    // The legal documents are wrapped at ~100 columns; a clause must not be
    // broken into separate paragraphs on screen.
    draw("To the fullest extent Philippine law permits, the Service is\nprovided as is.\n");
    expect(
      screen.getByText(
        "To the fullest extent Philippine law permits, the Service is provided as is.",
      ),
    ).toBeInTheDocument();
  });

  it("renders bold spans", () => {
    const { container } = draw("A **Limitation of liability** clause.\n");
    expect(container.querySelector("strong")?.textContent).toBe("Limitation of liability");
  });

  it("routes internal links through the SPA and opens external links safely", () => {
    const { container } = draw(
      "See the [Privacy Policy](/legal/privacy) and [the NPC](https://privacy.gov.ph).\n",
    );
    const internal = container.querySelector('a[href="/legal/privacy"]');
    expect(internal).toBeTruthy();
    expect(internal?.getAttribute("target")).toBeNull();

    const external = container.querySelector('a[href="https://privacy.gov.ph"]');
    expect(external?.getAttribute("target")).toBe("_blank");
    expect(external?.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("refuses javascript: links", () => {
    const { container } = draw("[click me](javascript:alert(1))\n");
    expect(container.querySelector("a")).toBeNull();
    expect(screen.getByText("click me")).toBeInTheDocument();
  });

  it("never executes embedded HTML", () => {
    // These pages are public and unauthenticated. The renderer builds React
    // elements rather than setting innerHTML, so markup in a document shows as
    // text instead of running.
    const { container } = draw("Before <img src=x onerror=alert(1)> after\n");
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<img src=x onerror=alert(1)>");
  });

  it("renders pipe tables with a header row", () => {
    const { container } = draw(
      "| Cookie | Purpose |\n|---|---|\n| Session | Keeps you signed in. |\n| CSRF | Blocks forgery. |\n",
    );
    expect(container.querySelectorAll("thead th")).toHaveLength(2);
    expect(container.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(screen.getByText("Keeps you signed in.")).toBeInTheDocument();
  });

  it("renders a horizontal rule", () => {
    const { container } = draw("Above\n\n---\n\nBelow\n");
    expect(container.querySelector("hr")).toBeTruthy();
  });

  it("greys out a detail still to follow, without its brackets", () => {
    const { container } = draw(
      "Operated by [[To follow]] (registration [[To follow]]), see [Terms](/legal/terms).\n",
    );
    const pending = screen.getAllByText("To follow");
    expect(pending).toHaveLength(2);
    expect(pending[0]).toHaveClass("text-muted");
    expect(container.textContent).not.toContain("[[");
    expect(screen.getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/legal/terms");
  });
});
