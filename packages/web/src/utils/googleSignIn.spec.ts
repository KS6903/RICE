import { afterEach, describe, expect, it, vi } from "vitest";
import { googleClientId, googleSignInEnabled } from "./googleSignIn";

describe("googleSignIn", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is off when no client ID is set, as on a local stack", () => {
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "");
    expect(googleSignInEnabled()).toBe(false);
    expect(googleClientId()).toBe("");
  });

  it("is off for a client ID that is only spaces", () => {
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "   ");
    expect(googleSignInEnabled()).toBe(false);
  });

  it("is on with a client ID, which it gives back trimmed", () => {
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", " 123-abc.apps.googleusercontent.com ");
    expect(googleSignInEnabled()).toBe(true);
    expect(googleClientId()).toBe("123-abc.apps.googleusercontent.com");
  });
});
