// Reading a weighing scale from the browser. Mills use many brands, and most indicators
// send their reading over a serial line as text, over and over, in one of these:
//
//   ST,GS,+  12450 kg            a line, stable and gross
//   US,GS,+  12380 kg            a line, still settling
//   ww000.000kg                  XK3190-A12: gross ww, net wn, tare wt
//   <STX>+001250 0 XX<ETX>       XK3190-A9+ tF=0: sign, 6 digits, decimals, XOR check
//   51.0700=                     XK3190-A9+ tF=2 and 3: digits reversed, so this is 70.15
//
// "auto" reads all of those. Anything else is set up on the computer the scale is wired to
// (ScaleSetup): the line's speed and framing, the weight's place in a line, and what to
// send a scale that only answers when asked.

export type ScaleReading = { kg: number; stable: boolean };

export type ScaleUnit = "kg" | "lb" | "t" | "g";

export type ScaleSettings = {
  baudRate: number;
  dataBits: 7 | 8;
  parity: "none" | "even" | "odd";
  stopBits: 1 | 2;
  /** The unit when the scale doesn't say. */
  unit: ScaleUnit;
  format: "auto" | "fixed";
  /** For "fixed": where the weight sits in a line, counting from 1, and how many characters. */
  start: number;
  length: number;
  /** For "fixed", when the line has no decimal point: how many of its digits are decimals. */
  decimals: number;
  /** The digits come lowest first. */
  reversed: boolean;
  /** Sent over and over for a scale that only answers when asked. \r, \n and \x02 are understood. */
  ask: string;
};

export const DEFAULT_SCALE_SETTINGS: ScaleSettings = {
  baudRate: 9600,
  dataBits: 8,
  parity: "none",
  stopBits: 1,
  unit: "kg",
  format: "auto",
  start: 1,
  length: 8,
  decimals: 0,
  reversed: false,
  ask: "",
};

const SETTINGS_KEY = "rice-mill-scale";
const OLD_BAUD_KEY = "rice-mill-scale-baud";

/** This computer's: each is wired to its own scale. */
export function loadScaleSettings(): ScaleSettings {
  try {
    const saved = localStorage.getItem(SETTINGS_KEY);
    if (saved) return { ...DEFAULT_SCALE_SETTINGS, ...JSON.parse(saved) };
    const baudRate = Number(localStorage.getItem(OLD_BAUD_KEY));
    return baudRate ? { ...DEFAULT_SCALE_SETTINGS, baudRate } : DEFAULT_SCALE_SETTINGS;
  } catch {
    return DEFAULT_SCALE_SETTINGS;
  }
}

export function saveScaleSettings(settings: ScaleSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // It just won't be remembered.
  }
}

const STX = "\x02";
const ETX = "\x03";

function toKg(value: number, unit: ScaleUnit): number {
  const kg =
    unit === "t"
      ? value * 1000
      : unit === "g"
        ? value / 1000
        : unit === "lb"
          ? value * 0.45359237
          : value;
  return Math.round(kg * 1000) / 1000;
}

/** One line from a scale, or null when it holds no weight. */
export function parseScaleLine(line: string, unit: ScaleUnit = "kg"): ScaleReading | null {
  if (/^\s*wt/i.test(line)) return null; // the tare, not what's on the deck
  const match = line.match(/([-+]?)\s*(\d+(?:\.\d+)?)\s*(kg|lb|g|t)?\s*$/i);
  if (!match || match[1] === "-") return null;
  const value = Number(match[2]);
  if (!Number.isFinite(value)) return null;
  // Marked unstable or in motion: not a weight to save. No mark: only repeats can tell.
  const stable = !/\b(US|MO|MOTION)\b/i.test(line);
  return { kg: toKg(value, (match[3]?.toLowerCase() as ScaleUnit) ?? unit), stable };
}

/** A line read by the weight's place in it, for a brand "auto" can't make out. */
export function parseFixedLine(line: string, settings: ScaleSettings): ScaleReading | null {
  const slice = line.slice(settings.start - 1, settings.start - 1 + settings.length).trim();
  const text = settings.reversed ? [...slice].reverse().join("") : slice;
  const match = text.match(/^([-+]?)\s*(\d+(?:\.\d+)?)$/);
  if (!match || match[1] === "-") return null;
  const value = match[2].includes(".")
    ? Number(match[2])
    : Number(match[2]) / 10 ** settings.decimals;
  return { kg: toKg(value, settings.unit), stable: !/\b(US|MO|MOTION)\b/i.test(line) };
}

/** An XK3190-A9+ continuous frame, without its end mark. Null if damaged on the way. */
export function parseChecksumFrame(frame: string, unit: ScaleUnit = "kg"): ScaleReading | null {
  const match = frame.startsWith(STX) && frame.slice(1).match(/^([-+])(\d{6})(\d)([0-9A-F]{2})$/);
  if (!match) return null;
  let check = 0;
  for (const char of frame.slice(1, 9)) check ^= char.charCodeAt(0);
  if (check !== parseInt(match[4], 16) || match[1] === "-") return null;
  return { kg: toKg(Number(match[2]) / 10 ** Number(match[3]), unit), stable: true };
}

/** Splits what has arrived into readings, and what's left waiting for the rest of a frame. */
export function readFrames(
  buffer: string,
  settings: ScaleSettings = DEFAULT_SCALE_SETTINGS,
): { readings: ScaleReading[]; rest: string } {
  const readings: ScaleReading[] = [];
  let start = 0;
  for (let i = 0; i < buffer.length; i++) {
    const end = buffer[i];
    if (end !== "\r" && end !== "\n" && end !== "=" && end !== ETX) continue;
    const frame = buffer.slice(start, i);
    start = i + 1;
    if (!frame.trim()) continue;
    let reading: ScaleReading | null;
    if (settings.format === "fixed") reading = parseFixedLine(frame, settings);
    else if (frame.startsWith(STX))
      reading = end === ETX ? parseChecksumFrame(frame, settings.unit) : null;
    else {
      const reversed = end === "=" || settings.reversed;
      reading = parseScaleLine(reversed ? [...frame].reverse().join("") : frame, settings.unit);
    }
    if (reading) readings.push(reading);
  }
  return { readings, rest: buffer.slice(start) };
}

/** The weight once the scale has settled: the same figure this many times running. */
export const READINGS_TO_SETTLE = 3;

export function settled(readings: ScaleReading[]): number | null {
  if (readings.length < READINGS_TO_SETTLE) return null;
  const last = readings.slice(-READINGS_TO_SETTLE);
  return last.every((r) => r.stable && r.kg === last[0].kg) && last[0].kg > 0 ? last[0].kg : null;
}

/** What to send, with \r, \n and \xNN written out as a person can type them. */
export function askBytes(text: string): Uint8Array {
  const decoded = text
    .replace(/\\x([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\r/g, "\r")
    .replace(/\\n/g, "\n");
  return Uint8Array.from(decoded, (c) => c.charCodeAt(0));
}

/** What came down the line, with what can't be seen written out, to read in Scale setup. */
export function showRaw(text: string): string {
  return [...text]
    .map((c) => {
      const code = c.charCodeAt(0);
      if (c === "\r") return "\\r";
      if (c === "\n") return "\\n\n";
      return code < 32 ? `\\x${code.toString(16).padStart(2, "0")}` : c;
    })
    .join("");
}

/** Whether this browser can talk to a serial port: Chrome and Edge on a computer. */
export const scaleSupported = () => typeof navigator !== "undefined" && "serial" in navigator;

const ASK_EVERY_MS = 700;

/** Listen to the scale until ``done`` says stop or time runs out. */
async function listen(
  settings: ScaleSettings,
  timeoutMs: number,
  onText: (text: string) => boolean,
): Promise<void> {
  const serial = (navigator as any).serial;
  // Once a computer has allowed one port, weighing doesn't ask again.
  const granted = await serial.getPorts();
  const port = granted.length === 1 ? granted[0] : await serial.requestPort();
  await port.open({
    baudRate: settings.baudRate,
    dataBits: settings.dataBits,
    parity: settings.parity,
    stopBits: settings.stopBits,
  });
  const reader = port.readable.getReader();
  const decoder = new TextDecoder();
  const timer = setTimeout(() => void reader.cancel(), timeoutMs);
  const writer = settings.ask ? port.writable.getWriter() : null;
  const ask = () => void writer?.write(askBytes(settings.ask)).catch(() => undefined);
  ask();
  const asking = writer ? setInterval(ask, ASK_EVERY_MS) : undefined;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      if (onText(decoder.decode(value, { stream: true }))) return;
    }
  } finally {
    clearTimeout(timer);
    clearInterval(asking);
    writer?.releaseLock();
    reader.releaseLock();
    await port.close().catch(() => undefined);
  }
}

/** Ask for the scale's port and read until the weight settles or time runs out. */
export async function readScale(settings: ScaleSettings, timeoutMs = 15_000): Promise<number> {
  const readings: ScaleReading[] = [];
  let buffer = "";
  let kg: number | null = null;
  await listen(settings, timeoutMs, (text) => {
    const framed = readFrames(buffer + text, settings);
    buffer = framed.rest;
    readings.push(...framed.readings);
    kg = settled(readings);
    return kg != null;
  });
  if (kg == null) throw new Error("no_stable_weight");
  return kg;
}

/** Listen for a few seconds: what came, and what could be read from it. */
export async function testScale(
  settings: ScaleSettings,
  timeoutMs = 5_000,
): Promise<{ raw: string; readings: ScaleReading[] }> {
  let raw = "";
  await listen(settings, timeoutMs, (text) => {
    raw += text;
    return raw.length > 2_000;
  });
  return { raw, readings: readFrames(raw, settings).readings };
}
