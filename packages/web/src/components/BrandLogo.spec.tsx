import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import BrandLogo from "./BrandLogo";

describe("BrandLogo", () => {
  it("strokes with the text colour by default", () => {
    const { container } = render(<BrandLogo />);
    expect(container.querySelector("svg")?.getAttribute("stroke")).toBe("currentColor");
    expect(container.querySelector("linearGradient")).toBeNull();
  });

  it("points each gradient logo at its own gradient, even two on one page", () => {
    // The admin console shows it twice (sidebar and avatar); a shared id would
    // let one logo paint with the other's gradient, or with nothing.
    const { container } = render(
      <>
        <BrandLogo gradient />
        <BrandLogo gradient />
      </>,
    );
    const ids = [...container.querySelectorAll("svg")].map(
      (svg) => svg.getAttribute("stroke")?.match(/^url\(#([\w-]+)\)$/)?.[1],
    );
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) {
      expect(container.querySelector(`linearGradient[id="${id}"]`)).not.toBeNull();
    }
  });
});
