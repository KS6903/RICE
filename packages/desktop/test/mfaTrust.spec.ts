import { describe, expect, it } from "vitest";
import { MfaTrustJar, MfaTrustStore, trustClaims } from "../main/security/mfaTrust";

const NOW = Date.UTC(2026, 9, 22, 6, 0, 0);
const DAY = 86_400;

/** A token shaped like the API's (only the payload matters here). */
function token(sub: string, exp: number, jti = sub): string {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "HS256" })}.${part({ sub, exp, jti, type: "mfa_trust" })}.signature`;
}

function memoryStore(initial: unknown[] = []): MfaTrustStore & { saved: string[][] } {
  const saved: string[][] = [];
  return {
    saved,
    load: () => initial as string[],
    save: (tokens) => saved.push([...tokens]),
  };
}

const live = (sub: string, jti?: string) => token(sub, NOW / 1000 + 3 * DAY, jti);
const expired = (sub: string) => token(sub, NOW / 1000 - 1);

describe("trustClaims", () => {
  it("reads the account and expiry", () => {
    expect(trustClaims(live("u1"))).toEqual({ sub: "u1", exp: NOW / 1000 + 3 * DAY });
  });

  it("refuses anything that isn't a token", () => {
    for (const bad of ["", "a.b", "a..c", "x".repeat(5_000), "a.!!!.c", token("u1", Number.NaN)]) {
      expect(trustClaims(bad)).toBeNull();
    }
  });
});

describe("MfaTrustJar", () => {
  it("has nothing to send on a new device", () => {
    expect(new MfaTrustJar(memoryStore(), () => NOW).header()).toBeNull();
  });

  it("sends every account's trust, and keeps it across restarts", () => {
    const store = memoryStore();
    const jar = new MfaTrustJar(store, () => NOW);
    jar.add(live("owner"));
    jar.add(live("bossadmin"));
    expect(jar.header()).toBe(`${live("bossadmin")}, ${live("owner")}`);

    const restarted = new MfaTrustJar(memoryStore(store.saved.at(-1)), () => NOW);
    expect(restarted.header()).toBe(jar.header());
  });

  it("keeps only an account's newest trust", () => {
    const jar = new MfaTrustJar(memoryStore(), () => NOW);
    jar.add(live("owner", "first"));
    jar.add(live("owner", "second"));
    expect(jar.header()).toBe(live("owner", "second"));
  });

  it("drops trust that has lapsed, and anything that isn't a token", () => {
    const jar = new MfaTrustJar(
      memoryStore([expired("old"), 42, "junk", live("owner")]),
      () => NOW,
    );
    expect(jar.header()).toBe(live("owner"));
    jar.add("not-a-token");
    expect(jar.header()).toBe(live("owner"));
  });

  it("stops sending trust once Sunday passes", () => {
    let now = NOW;
    const jar = new MfaTrustJar(memoryStore(), () => now);
    jar.add(live("owner"));
    now += 4 * DAY * 1000;
    expect(jar.header()).toBeNull();
  });

  it("holds at most ten accounts", () => {
    const jar = new MfaTrustJar(memoryStore(), () => NOW);
    for (let i = 0; i < 12; i++) jar.add(live(`user${i}`));
    expect(jar.header()!.split(", ")).toHaveLength(10);
    expect(jar.header()).toContain(live("user11"));
    expect(jar.header()).not.toContain(live("user0"));
  });
});
