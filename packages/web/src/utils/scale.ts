// Reading a weighing scale from the browser. Truck-scale indicators send their reading
// over a serial line, over and over, in one of these (9600 8N1 or slower):
//
//   ST,GS,+  12450 kg            a line, stable and gross
//   US,GS,+  12380 kg            a line, still settling
//   ww000.000kg                  XK3190-A12: gross ww, net wn, tare wt
//   <STX>+001250 0 XX<ETX>       XK3190-A9+ tF=0: sign, 6 digits, decimals, XOR check
//   51.0700=                     XK3190-A9+ tF=2 and 3: digits reversed, so this is 70.15
//
// Which of them a given scale sends depends on its model and settings, so this reads them
// all. An indicator set to answer commands only (A9+ tF=1) sends nothing until asked, and
// has to be set back to one of the continuous modes.

export type ScaleReading = { kg: number; stable: boolean };

const STX = "\x02";
const ETX = "\x03";

/** One line from a scale, or null when it holds no weight. */
export function parseScaleLine(line: string): ScaleReading | null {
  if (/^\s*wt/i.test(line)) return null; // the tare, not what's on the deck
  const match = line.match(/([-+]?)\s*(\d+(?:\.\d+)?)\s*(kg|lb|g|t)?\s*$/i);
  if (!match || match[1] === "-") return null;
  const value = Number(match[2]);
  if (!Number.isFinite(value)) return null;
  const unit = (match[3] ?? "kg").toLowerCase();
  const kg =
    unit === "t"
      ? value * 1000
      : unit === "g"
        ? value / 1000
        : unit === "lb"
          ? value * 0.45359237
          : value;
  // Marked unstable or in motion: not a weight to save. No mark: only repeats can tell.
  const stable = !/\b(US|MO|MOTION)\b/i.test(line);
  return { kg: Math.round(kg * 1000) / 1000, stable };
}

/** An XK3190-A9+ continuous frame, without its end mark. Null if damaged on the way. */
export function parseChecksumFrame(frame: string): ScaleReading | null {
  const match = frame.startsWith(STX) && frame.slice(1).match(/^([-+])(\d{6})(\d)([0-9A-F]{2})$/);
  if (!match) return null;
  let check = 0;
  for (const char of frame.slice(1, 9)) check ^= char.charCodeAt(0);
  if (check !== parseInt(match[4], 16) || match[1] === "-") return null;
  return { kg: Number(match[2]) / 10 ** Number(match[3]), stable: true };
}

/** Splits what has arrived into readings, and what's left waiting for the rest of a frame. */
export function readFrames(buffer: string): { readings: ScaleReading[]; rest: string } {
  const readings: ScaleReading[] = [];
  let start = 0;
  for (let i = 0; i < buffer.length; i++) {
    const end = buffer[i];
    if (end !== "\r" && end !== "\n" && end !== "=" && end !== ETX) continue;
    const frame = buffer.slice(start, i);
    start = i + 1;
    if (!frame.trim()) continue;
    const reading = frame.startsWith(STX)
      ? end === ETX
        ? parseChecksumFrame(frame)
        : null
      : parseScaleLine(end === "=" ? [...frame].reverse().join("") : frame);
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

/** Whether this browser can talk to a serial port: Chrome and Edge on a computer. */
export const scaleSupported = () => typeof navigator !== "undefined" && "serial" in navigator;

/** Ask for the scale's port and read until the weight settles or time runs out. */
export async function readScale(baudRate: number, timeoutMs = 15_000): Promise<number> {
  const port = await (navigator as any).serial.requestPort();
  await port.open({ baudRate });
  const reader = port.readable.getReader();
  const decoder = new TextDecoder();
  const timer = setTimeout(() => void reader.cancel(), timeoutMs);
  const readings: ScaleReading[] = [];
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const framed = readFrames(buffer);
      buffer = framed.rest;
      readings.push(...framed.readings);
      const kg = settled(readings);
      if (kg != null) return kg;
    }
    throw new Error("no_stable_weight");
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
    await port.close().catch(() => undefined);
  }
}
