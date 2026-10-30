// The Wet / Dry check boxes on a palay line: one or the other. Only the check mark
// is coloured (rose for wet, green for dry, as the purchase list shows them); the
// words stay the ordinary text colour.
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
  const word =
    "flex cursor-pointer select-none items-center gap-2 text-sm font-medium text-primary";
  return (
    <div
      role="group"
      aria-label={name ? t("Condition of {{name}}", { name }) : t("Condition")}
      className="flex h-[2.75rem] items-center gap-5"
    >
      <label className={word}>
        <input
          type="checkbox"
          className={`${box} accent-rose-500`}
          checked={wet}
          onChange={() => onChange(true)}
        />
        {t("Wet")}
      </label>
      <label className={word}>
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
