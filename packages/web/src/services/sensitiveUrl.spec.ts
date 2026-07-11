import { describe, expect, it } from "vitest";
import { consumeSensitiveUrlToken } from "./sensitiveUrl";

describe("sensitive URL tokens", () => {
  it("prefers a fragment token and scrubs both fragment and legacy query copies", () => {
    history.replaceState({}, "", "/reset-password?token=query&keep=1#token=fragment");

    expect(consumeSensitiveUrlToken()).toBe("fragment");
    expect(location.pathname + location.search + location.hash).toBe("/reset-password?keep=1");
  });
});
