// Reads a palay line's weight off the scale, where the browser can reach one (Chrome or
// Edge on a computer, with the scale on a serial or USB-serial cable). A weight read this
// way is marked "scale" and can't be typed over until someone chooses to enter it by hand.
import { useState } from "react";
import { Scale } from "lucide-react";
import { readScale, scaleSupported } from "../../utils/scale";
import { t } from "../../i18n";

const BAUD_KEY = "rice-mill-scale-baud";
const BAUD_RATES = [1200, 2400, 4800, 9600, 19200];

function savedBaud(): number {
  try {
    return Number(localStorage.getItem(BAUD_KEY)) || 9600;
  } catch {
    return 9600;
  }
}

export default function ScaleButton({
  fromScale,
  onRead,
  onClear,
}: {
  fromScale: boolean;
  onRead: (kg: number) => void;
  onClear: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [baud, setBaud] = useState(savedBaud);
  if (!scaleSupported()) return null;

  const read = async () => {
    setBusy(true);
    setError(null);
    try {
      onRead(await readScale(baud));
    } catch (e: any) {
      // Closing the browser's port list isn't a failure.
      if (e?.name !== "NotFoundError") {
        setError(t("No steady weight came from the scale. Check its cable and speed."));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-1 space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="inline-flex items-center gap-1 text-xs font-semibold text-secondary hover:text-primary"
          disabled={busy}
          onClick={() => void read()}
        >
          <Scale size={12} aria-hidden />
          {busy ? t("Waiting for the scale…") : t("Read from scale")}
        </button>
        <select
          aria-label={t("Scale speed")}
          className="text-xs bg-transparent text-secondary"
          value={baud}
          onChange={(e) => {
            const next = Number(e.target.value);
            setBaud(next);
            try {
              localStorage.setItem(BAUD_KEY, String(next));
            } catch {
              // The speed just won't be remembered.
            }
          }}
        >
          {BAUD_RATES.map((rate) => (
            <option key={rate} value={rate}>
              {rate}
            </option>
          ))}
        </select>
      </div>
      {fromScale && (
        <button type="button" className="block text-xs text-secondary underline" onClick={onClear}>
          {t("From the scale. Enter by hand instead")}
        </button>
      )}
      {error && <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}
    </div>
  );
}
