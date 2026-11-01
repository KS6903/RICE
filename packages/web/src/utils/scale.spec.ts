import { describe, expect, it } from "vitest";
import { parseChecksumFrame, parseScaleLine, readFrames, settled } from "./scale";

// An XK3190-A9+ continuous frame, with its XOR check as the manual describes.
const a9Frame = (body: string) => {
  let check = 0;
  for (const char of body) check ^= char.charCodeAt(0);
  return `\x02${body}${check.toString(16).toUpperCase().padStart(2, "0")}\x03`;
};

describe("readFrames", () => {
  it("reads the XK3190-A12's lines, and leaves out its tare", () => {
    const { readings } = readFrames("ww012.450kg\r\nwn012.450kg\r\nwt001.000kg\r\n");
    expect(readings).toEqual([
      { kg: 12.45, stable: true },
      { kg: 12.45, stable: true },
    ]);
  });

  it("reads the A9+'s checked frames, which have no line ends", () => {
    const { readings, rest } = readFrames(a9Frame("+0124500") + a9Frame("+0124501") + "\x02+01");
    expect(readings).toEqual([
      { kg: 12450, stable: true },
      { kg: 1245, stable: true },
    ]);
    expect(rest).toBe("\x02+01");
  });

  it("reads the manual's reversed example: 70.15 sent as 51.0700=", () => {
    expect(readFrames("51.0700=51.0700=51.07").readings).toEqual([
      { kg: 70.15, stable: true },
      { kg: 70.15, stable: true },
    ]);
    expect(readFrames("51.07000=").readings).toEqual([{ kg: 70.15, stable: true }]);
  });

  it("refuses a frame damaged on the way, and a negative one", () => {
    const good = a9Frame("+0124500");
    expect(readFrames(good.replace("2450", "2451")).readings).toEqual([]);
    expect(parseChecksumFrame(a9Frame("-0124500").slice(0, -1))).toBeNull();
  });
});

describe("parseScaleLine", () => {
  it("reads the common indicator formats", () => {
    expect(parseScaleLine("ST,GS,+  12450 kg")).toEqual({ kg: 12450, stable: true });
    expect(parseScaleLine("=0012450")).toEqual({ kg: 12450, stable: true });
    expect(parseScaleLine("12.45 t")).toEqual({ kg: 12450, stable: true });
    expect(parseScaleLine("1000 lb")).toEqual({ kg: 453.592, stable: true });
  });

  it("marks a weight that is still settling", () => {
    expect(parseScaleLine("US,GS,+  12380 kg")?.stable).toBe(false);
  });

  it("ignores what holds no weight", () => {
    expect(parseScaleLine("HELLO")).toBeNull();
    expect(parseScaleLine("ST,GS,-   20 kg")).toBeNull();
  });
});

describe("settled", () => {
  const at = (kg: number, stable = true) => ({ kg, stable });

  it("waits for the same stable weight three times running", () => {
    expect(settled([at(100), at(100)])).toBeNull();
    expect(settled([at(90), at(100), at(100), at(100)])).toBe(100);
    expect(settled([at(100), at(100), at(100, false)])).toBeNull();
    expect(settled([at(100), at(101), at(100)])).toBeNull();
  });

  it("doesn't take an empty deck for a weight", () => {
    expect(settled([at(0), at(0), at(0)])).toBeNull();
  });
});
