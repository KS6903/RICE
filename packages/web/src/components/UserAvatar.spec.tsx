import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import UserAvatar from "./UserAvatar";

describe("UserAvatar", () => {
  it("draws a figure in the text colour, not the user's initials", () => {
    const { container } = render(<UserAvatar name="Rice Mill 1" />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("stroke")).toBe("currentColor");
    expect(svg.querySelector("ellipse")).not.toBeNull();
    // The only text is the tooltip's <title>; no "RM" anywhere.
    expect(svg.textContent).toBe("Rice Mill 1");
    expect(screen.getByRole("img", { name: "Rice Mill 1's profile picture" })).toBeTruthy();
  });

  it("gives each avatar its own clip and masks, even two on one page", () => {
    // The Settings page shows the header avatar and the profile one together;
    // shared ids would let one avatar cut its lines with the other's shapes.
    const { container } = render(
      <>
        <UserAvatar />
        <UserAvatar />
      </>,
    );
    const refs = [...container.querySelectorAll("[clip-path], [mask]")].map(
      (el) =>
        (el.getAttribute("clip-path") ?? el.getAttribute("mask"))?.match(/^url\(#([\w-]+)\)$/)?.[1],
    );
    expect(refs.length).toBeGreaterThan(2);
    expect(refs.every(Boolean)).toBe(true);
    expect(new Set(refs).size).toBe(refs.length);
    for (const id of refs) {
      expect(container.querySelector(`[id="${id}"]`)).not.toBeNull();
    }
  });

  it("still has a label when the name isn't known yet", () => {
    render(<UserAvatar />);
    expect(screen.getByRole("img", { name: "Profile picture" })).toBeTruthy();
  });
});
