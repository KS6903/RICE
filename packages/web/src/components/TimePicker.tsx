import { useMemo } from "react";
import Select from "./Select";
import type { SelectOption } from "./Select";

type Props = {
  /** "HH:mm" in 24 hours, the same as an <input type="time">. */
  value: string;
  onChange: (value: string) => void;
  /** For a <label htmlFor>. */
  id?: string;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  /** Minutes between the times offered. */
  stepMinutes?: number;
  "aria-label"?: string;
  "data-testid"?: string;
};

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** "06:30" -> "6:30 AM". */
export function timeLabel(value: string): string {
  const m = TIME.exec(value);
  if (!m) return value;
  const hour = Number(m[1]);
  return `${hour % 12 || 12}:${m[2]} ${hour < 12 ? "AM" : "PM"}`;
}

/**
 * A time field in the app's own dropdown instead of the browser's native clock.
 * It offers the day in steps (every 15 minutes by default); a time already set
 * that falls between steps is kept in the list rather than rounded away.
 */
export default function TimePicker({
  value,
  onChange,
  stepMinutes = 15,
  placeholder = "Choose a time",
  ...rest
}: Props) {
  const options = useMemo(() => {
    const times: string[] = [];
    for (let minute = 0; minute < 24 * 60; minute += stepMinutes) {
      const hh = String(Math.floor(minute / 60)).padStart(2, "0");
      const mm = String(minute % 60).padStart(2, "0");
      times.push(`${hh}:${mm}`);
    }
    if (TIME.test(value) && !times.includes(value)) {
      times.push(value);
      times.sort();
    }
    return times.map<SelectOption>((t) => ({ value: t, label: timeLabel(t) }));
  }, [stepMinutes, value]);

  return (
    <Select
      {...rest}
      value={value}
      onChange={onChange}
      options={options}
      placeholder={placeholder}
    />
  );
}
