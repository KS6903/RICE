// Reads a palay line's weight off the scale, where the browser can reach one (Chrome or
// Edge on a computer, with the scale on a serial or USB-serial cable). A weight read this
// way is marked "scale" and can't be typed over until someone chooses to enter it by hand.
import { useState } from "react";
import { Scale } from "lucide-react";
import { loadScaleSettings, readScale, scaleSupported } from "../../utils/scale";
import ScaleSetup from "./ScaleSetup";
import { t } from "../../i18n";

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
  const [setup, setSetup] = useState(false);
  if (!scaleSupported()) return null;

  const read = async () => {
    setBusy(true);
    setError(null);
    try {
      onRead(await readScale(loadScaleSettings()));
    } catch (e: any) {
      // Closing the browser's port list isn't a failure.
      if (e?.name !== "NotFoundError") {
        setError(t("No steady weight came from the scale. Check its cable, or open Scale setup."));
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
        <button
          type="button"
          className="text-xs text-secondary underline"
          onClick={() => setSetup(true)}
        >
          {t("Scale setup")}
        </button>
      </div>
      {fromScale && (
        <button type="button" className="block text-xs text-secondary underline" onClick={onClear}>
          {t("From the scale. Enter by hand instead")}
        </button>
      )}
      {error && <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}
      {setup && <ScaleSetup onClose={() => setSetup(false)} />}
    </div>
  );
}
