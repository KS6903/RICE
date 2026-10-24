import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetWarmUpForTests, serverUnreachableMessage, warmUpApi } from "./warmUp";

describe("serverUnreachableMessage", () => {
  it("says the server couldn't be reached when no answer came back", () => {
    expect(serverUnreachableMessage({ request: {} })).toMatch(/Couldn't reach the server/);
  });

  it("says the server is starting for a gateway error or the Worker's upstream_unavailable", () => {
    for (const response of [
      { status: 502, data: {} },
      { status: 504, data: "" },
      {
        status: 503,
        data: { detail: "Service temporarily unavailable", code: "upstream_unavailable" },
      },
    ]) {
      expect(serverUnreachableMessage({ request: {}, response })).toMatch(/still starting up/);
    }
  });

  it("leaves an answer the server gave to the caller", () => {
    const answered = (status: number, detail: string) =>
      serverUnreachableMessage({ request: {}, response: { status, data: { detail } } });
    expect(answered(401, "Invalid credentials")).toBeNull();
    expect(answered(503, "Sign-up is paused for maintenance.")).toBeNull();
    expect(serverUnreachableMessage(new Error("not a request at all"))).toBeNull();
  });
});

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
