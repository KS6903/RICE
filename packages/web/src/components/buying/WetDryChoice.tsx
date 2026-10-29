// The Wet / Dry check boxes on a palay line: one or the other, wet in red and
// dry in green, as the purchase list shows them.
import { t } from "../../i18n";

export default function WetDryChoice({
  wet,
  onChange,
  name,
}: {
  wet: boolean;
  onChange: (wet: boolean) => void;
  /** Tells apart the groups of several lines. */
  name?: string;
}) {
  const box = "h-4 w-4 rounded border-soft cursor-pointer";
  return (
    <div
      role="group"
      aria-label={name ? t("Condition of {{name}}", { name }) : t("Condition")}
      className="flex h-10 items-center gap-4"
    >
      <label
        className={`flex cursor-pointer select-none items-center gap-1.5 text-sm font-medium ${wet ? "text-rose-600 dark:text-rose-400" : "text-secondary"}`}
      >
        <input
          type="checkbox"
          className={`${box} accent-rose-500`}
          checked={wet}
          onChange={() => onChange(true)}
        />
        {t("Wet")}
      </label>
      <label
        className={`flex cursor-pointer select-none items-center gap-1.5 text-sm font-medium ${wet ? "text-secondary" : "text-emerald-600 dark:text-emerald-400"}`}
      >
        <input
          type="checkbox"
          className={`${box} accent-emerald-500`}
          checked={!wet}
          onChange={() => onChange(false)}
        />
        {t("Dry")}
      </label>
    </div>
  );
}
