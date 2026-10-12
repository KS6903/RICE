import { clsx } from "clsx";
import DatePicker from "./DatePicker";
import TimePicker from "./TimePicker";

type Props = {
  /** "yyyy-MM-ddTHH:mm", the same as an <input type="datetime-local">. */
  value: string;
  onChange: (value: string) => void;
  /** For a <label htmlFor>; lands on the date half. */
  id?: string;
  disabled?: boolean;
  className?: string;
  /** Names both halves: "Start" becomes "Start date" and "Start time". */
  label: string;
};

// What the time becomes when only a date has been chosen so far.
const DEFAULT_TIME = "08:00";

function split(value: string): [string, string] {
  const [date = "", time = ""] = value.split("T");
  return [date, time.slice(0, 5)];
}

function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * A date and a time side by side, each in the app's own picker, in place of the
 * browser's native date-time field.
 */
export default function DateTimePicker({ value, onChange, id, disabled, className, label }: Props) {
  const [date, time] = split(value);
  return (
    <div className={clsx("flex gap-2", className)}>
      <DatePicker
        id={id}
        aria-label={`${label} date`}
        disabled={disabled}
        className="min-w-0 flex-1"
        value={date}
        onChange={(d) => onChange(`${d}T${time || DEFAULT_TIME}`)}
      />
      <TimePicker
        aria-label={`${label} time`}
        disabled={disabled}
        className="w-36 shrink-0"
        value={time}
        onChange={(t) => onChange(`${date || todayIso()}T${t}`)}
      />
    </div>
  );
}
