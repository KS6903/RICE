// Reading a weighing scale from the browser. Most truck-scale indicators send their
// reading over a serial line as plain text, over and over, in formats like these:
//
//   ST,GS,+  12450 kg      (stable, gross)
//   US,GS,+  12380 kg      (still settling)
//   =0012450               (no marks at all)
//
// Which of them a given scale sends depends on its model, so this reads the number and
// the stable mark rather than one brand's layout.

export type ScaleReading = { kg: number; stable: boolean };

/** One line from a scale, or null when it holds no weight. */
export function parseScaleLine(line: string): ScaleReading | null {
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
      const lines = buffer.split(/[\r\n]+/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const reading = parseScaleLine(line);
        if (!reading) continue;
        readings.push(reading);
        const kg = settled(readings);
        if (kg != null) return kg;
      }
    }
    throw new Error("no_stable_weight");
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
    await port.close().catch(() => undefined);
  }
}
