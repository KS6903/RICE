// Setting a computer up for whatever scale it's wired to, since mills use many brands:
// the line's speed and framing, where the weight sits if "automatic" can't find it, and
// a test that shows what really comes down the line.
import { useState } from "react";
import FieldCaption from "../FieldCaption";
import Modal from "../Modal";
import Select from "../Select";
import {
  loadScaleSettings,
  saveScaleSettings,
  showRaw,
  testScale,
  type ScaleReading,
  type ScaleSettings,
} from "../../utils/scale";
import { t } from "../../i18n";

const options = (values: (string | number)[]) =>
  values.map((v) => ({ value: String(v), label: String(v) }));

export default function ScaleSetup({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState<ScaleSettings>(loadScaleSettings);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ raw: string; readings: ScaleReading[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const set = (change: Partial<ScaleSettings>) => setSettings((s) => ({ ...s, ...change }));

  const test = async () => {
    setTesting(true);
    setFailed(false);
    setResult(null);
    try {
      setResult(await testScale(settings));
    } catch (e: any) {
      if (e?.name !== "NotFoundError") setFailed(true);
    } finally {
      setTesting(false);
    }
  };

  const number = (name: "start" | "length" | "decimals", label: string, min: number) => (
    <FieldCaption label={label}>
      <input
        className="input"
        type="number"
        min={min}
        value={settings[name]}
        onChange={(e) => set({ [name]: Math.max(min, Number(e.target.value) || min) })}
      />
    </FieldCaption>
  );

  return (
    <Modal
      open
      title={t("Scale setup")}
      subtitle={t(
        "Saved on this computer. Most scales work on Automatic: match the speed to the one in your scale's own settings or manual, then test.",
      )}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>
            {t("Cancel")}
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              saveScaleSettings(settings);
              onClose();
            }}
          >
            {t("Save")}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <FieldCaption label={t("Speed (baud)")}>
            <Select
              value={String(settings.baudRate)}
              onChange={(v) => set({ baudRate: Number(v) })}
              options={options([600, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200])}
            />
          </FieldCaption>
          <FieldCaption label={t("Data bits")}>
            <Select
              value={String(settings.dataBits)}
              onChange={(v) => set({ dataBits: Number(v) as 7 | 8 })}
              options={options([8, 7])}
            />
          </FieldCaption>
          <FieldCaption label={t("Parity")}>
            <Select
              value={settings.parity}
              onChange={(v) => set({ parity: v as ScaleSettings["parity"] })}
              options={[
                { value: "none", label: t("None") },
                { value: "even", label: t("Even") },
                { value: "odd", label: t("Odd") },
              ]}
            />
          </FieldCaption>
          <FieldCaption label={t("Stop bits")}>
            <Select
              value={String(settings.stopBits)}
              onChange={(v) => set({ stopBits: Number(v) as 1 | 2 })}
              options={options([1, 2])}
            />
          </FieldCaption>
          <FieldCaption label={t("Unit, when the scale doesn't say")}>
            <Select
              value={settings.unit}
              onChange={(v) => set({ unit: v as ScaleSettings["unit"] })}
              options={[
                { value: "kg", label: t("Kilos") },
                { value: "t", label: t("Tons") },
                { value: "lb", label: t("Pounds") },
                { value: "g", label: t("Grams") },
              ]}
            />
          </FieldCaption>
          <FieldCaption label={t("Finding the weight")}>
            <Select
              value={settings.format}
              onChange={(v) => set({ format: v as ScaleSettings["format"] })}
              options={[
                { value: "auto", label: t("Automatic") },
                { value: "fixed", label: t("At a set place in the line") },
              ]}
            />
          </FieldCaption>
        </div>
        {settings.format === "fixed" && (
          <div className="grid grid-cols-3 gap-3">
            {number("start", t("Starts at character"), 1)}
            {number("length", t("Characters"), 1)}
            {number("decimals", t("Decimal places"), 0)}
          </div>
        )}
        <label className="flex items-center gap-2 text-sm text-primary">
          <input
            type="checkbox"
            checked={settings.reversed}
            onChange={(e) => set({ reversed: e.target.checked })}
          />
          {t("The digits come backwards")}
        </label>
        <FieldCaption label={t("What to send, if the scale only answers when asked")}>
          <input
            className="input"
            placeholder={t("Leave empty if it sends by itself")}
            value={settings.ask}
            onChange={(e) => set({ ask: e.target.value })}
          />
        </FieldCaption>
        <div className="space-y-2">
          <button
            type="button"
            className="btn-secondary"
            disabled={testing}
            onClick={() => void test()}
          >
            {testing ? t("Listening for 5 seconds…") : t("Test the scale")}
          </button>
          {failed && (
            <p className="text-sm text-rose-600 dark:text-rose-400">
              {t(
                "The scale's port couldn't be opened. Check the cable, and close other programs using it.",
              )}
            </p>
          )}
          {result && (
            <div className="space-y-1 text-sm">
              {result.raw ? (
                <>
                  <p className="text-secondary">{t("What the scale sent:")}</p>
                  <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded-lg bg-[rgb(var(--ink)/0.05)] p-2 text-xs text-primary">
                    {showRaw(result.raw).slice(0, 600)}
                  </pre>
                  <p className="text-primary">
                    {result.readings.length > 0
                      ? t("Read as {{kg}} kg.", {
                          kg: result.readings[result.readings.length - 1].kg,
                        })
                      : t(
                          "No weight could be read from that. Check the speed, or set where the weight sits in the line.",
                        )}
                  </p>
                </>
              ) : (
                <p className="text-secondary">
                  {t(
                    "Nothing came. Check the speed and the cable, and whether the scale needs asking.",
                  )}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
