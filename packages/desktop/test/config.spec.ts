import { describe, expect, it } from "vitest";
import { parseConfig } from "../main/config";

const packaged = { packaged: true };

describe("parseConfig", () => {
  it("takes an https origin, without a trailing slash", () => {
    expect(parseConfig({ apiOrigin: "https://app.example.com/", updates: true }, packaged)).toEqual(
      {
        apiOrigin: "https://app.example.com",
        updates: true,
      },
    );
  });

  it("never lets a packaged build talk in clear text", () => {
    expect(() => parseConfig({ apiOrigin: "http://app.example.com" }, packaged)).toThrow(/https/);
    expect(() => parseConfig({ apiOrigin: "http://localhost:8000" }, packaged)).toThrow(/https/);
  });

  it("allows the local API in development only", () => {
    expect(parseConfig({ apiOrigin: "http://localhost:8000" }, { packaged: false }).apiOrigin).toBe(
      "http://localhost:8000",
    );
  });

  it("refuses anything but a bare origin", () => {
    for (const apiOrigin of [
      "https://app.example.com/api",
      "https://user:pw@app.example.com",
      "https://app.example.com/?x=1",
      "not a url",
    ]) {
      expect(() => parseConfig({ apiOrigin }, packaged)).toThrow();
    }
    expect(() => parseConfig(null, packaged)).toThrow();
  });

  it("leaves updates off unless the build says so", () => {
    expect(
      parseConfig({ apiOrigin: "https://a.example.com", updates: "yes" }, packaged).updates,
    ).toBe(false);
  });
});
