import { describe, expect, it } from "vitest";
import { canvaSocketUrl } from "./useRealtimeCanva";

const page = (protocol: string, host: string) => ({
  protocol,
  host,
  hostname: host.split(":")[0],
});

describe("canvaSocketUrl", () => {
  it("uses the desktop build's API, never the app:// page", () => {
    expect(canvaSocketUrl("L1", page("app:", "oryza"), "https://api.example.com", false)).toBe(
      "wss://api.example.com/ws/canva/L1",
    );
  });

  it("uses ws for a local desktop API", () => {
    expect(
      canvaSocketUrl("L1", page("http:", "localhost:8448"), "http://localhost:8000", true),
    ).toBe("ws://localhost:8000/ws/canva/L1");
  });

  it("follows the page in a browser", () => {
    expect(canvaSocketUrl("L 1", page("https:", "mill.example.com"), undefined, false)).toBe(
      "wss://mill.example.com/ws/canva/L%201",
    );
    expect(canvaSocketUrl("L1", page("http:", "localhost:8448"), undefined, true)).toBe(
      "ws://localhost:8000/ws/canva/L1",
    );
  });
});
