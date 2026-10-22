import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  apiTarget,
  forwardedHeaders,
  isApiPath,
  isAppUrl,
  sendsMfaTrust,
  staticFile,
} from "../main/appRoutes";

let root: string;
let outside: string;

beforeAll(() => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "app-routes-"));
  root = path.join(base, "web");
  fs.mkdirSync(path.join(root, "assets"), { recursive: true });
  fs.writeFileSync(path.join(root, "index.html"), "<html></html>");
  fs.writeFileSync(path.join(root, "assets", "app.js"), "");
  outside = path.join(base, "secret.txt");
  fs.writeFileSync(outside, "not for the renderer");
});

afterAll(() => fs.rmSync(path.dirname(root), { recursive: true, force: true }));

describe("staticFile", () => {
  it("serves the bundle's files", () => {
    expect(staticFile(root, "/assets/app.js")).toBe(path.join(root, "assets", "app.js"));
  });

  it("serves index.html for the SPA's routes", () => {
    for (const route of ["/", "/automations", "/admin/tenants/123", "/assets"]) {
      expect(staticFile(root, route)).toBe(path.join(root, "index.html"));
    }
  });

  it("never serves anything outside the bundle", () => {
    for (const attempt of [
      "/../secret.txt",
      "/%2e%2e/secret.txt",
      "/..%2fsecret.txt",
      "/..%5csecret.txt",
      "/assets/%00app.js",
      "/%E0%A4%A",
    ]) {
      expect(staticFile(root, attempt)).toBe(path.join(root, "index.html"));
    }
  });
});

describe("isAppUrl", () => {
  it('knows the app\'s own URLs, though their origin reads as "null"', () => {
    const url = new URL("app://oraiza/settings?tab=data");
    expect(url.origin).toBe("null"); // why origins can't be compared here
    expect(isAppUrl(url)).toBe(true);
  });

  it("refuses everything else", () => {
    for (const raw of [
      "app://evil/",
      "app://user:pw@oraiza/",
      "https://oraiza/",
      "file:///C:/oraiza/index.html",
      "http://localhost:8448/",
    ]) {
      expect(isAppUrl(new URL(raw))).toBe(false);
    }
  });
});

describe("the API route", () => {
  it("is /api and below, only", () => {
    expect(isApiPath("/api")).toBe(true);
    expect(isApiPath("/api/auth/me")).toBe(true);
    expect(isApiPath("/apiary")).toBe(false);
    expect(isApiPath("/")).toBe(false);
  });

  it("goes to the configured origin with its query", () => {
    const url = new URL("app://oraiza/api/sync/pull?since=2026-01-01T00:00:00Z");
    expect(apiTarget("https://app.example.com", url)).toBe(
      "https://app.example.com/api/sync/pull?since=2026-01-01T00:00:00Z",
    );
  });

  it("carries the version and none of the page's own headers", () => {
    const headers = forwardedHeaders(
      new Headers({
        Authorization: "Bearer t",
        Origin: "app://oraiza",
        Referer: "app://oraiza/settings",
        Cookie: "a=b",
        "X-MFA-Trust": "from-the-page",
        "Content-Type": "application/json",
      }),
      "1.4.0",
    );
    expect(headers.get("authorization")).toBe("Bearer t");
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("x-client-version")).toBe("1.4.0");
    for (const name of ["origin", "referer", "cookie", "x-mfa-trust"]) {
      expect(headers.has(name)).toBe(false);
    }
  });

  it("sends the 2FA trust on sign-in only", () => {
    expect(sendsMfaTrust("/api/auth/login")).toBe(true);
    expect(sendsMfaTrust("/api/auth/google")).toBe(true);
    for (const other of [
      "/api/auth/me",
      "/api/auth/mfa/verify",
      "/api/sync/pull",
      "/api/auth/login/x",
    ]) {
      expect(sendsMfaTrust(other)).toBe(false);
    }
  });
});
