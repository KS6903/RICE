import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetWarmUpForTests, warmUpApi } from "./warmUp";

describe("warmUpApi", () => {
  beforeEach(() => resetWarmUpForTests());
  afterEach(() => vi.unstubAllGlobals());

  it("asks the API for its readiness once per page load", () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);

    warmUpApi();
    warmUpApi();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/health/ready", {
      cache: "no-store",
      credentials: "omit",
    });
  });

  it("shrugs off a failed request", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    expect(() => warmUpApi()).not.toThrow();
    await Promise.resolve();
  });
});
