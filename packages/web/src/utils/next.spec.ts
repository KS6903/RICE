import { describe, expect, it } from "vitest";
import { safeNext, withNext } from "./next";

const next = (query: string) => safeNext(new URLSearchParams(query));

describe("safeNext", () => {
  it("allows the page that asks for it", () => {
    expect(next("next=/retrieve-data")).toBe("/retrieve-data");
  });

  it.each([
    "",
    "next=https://evil.example/retrieve-data",
    "next=//evil.example",
    "next=/admin",
    "next=/retrieve-data/../admin",
    "next=javascript:alert(1)",
  ])("ignores anything else (%s)", (query) => {
    expect(next(query)).toBeNull();
  });
});

describe("withNext", () => {
  it("carries it on, or leaves the path alone", () => {
    expect(withNext("/login", "/retrieve-data")).toBe("/login?next=%2Fretrieve-data");
    expect(withNext("/login", null)).toBe("/login");
  });
});
