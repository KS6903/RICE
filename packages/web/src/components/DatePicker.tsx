import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Calendar, ChevronLeft, ChevronRight } from "lucide-react";
import { clsx } from "clsx";
import {
  addDays,
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isValid,
  parseISO,
  startOfMonth,
  startOfWeek,
} from "date-fns";

type Props = {
  /** "yyyy-MM-dd", the same as an <input type="date">. */
  value: string;
  onChange: (value: string) => void;
  /** For a <label htmlFor>. */
  id?: string;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  "aria-label"?: string;
};

const GAP = 6;
const WIDTH = 288; // w-72
const HEIGHT = 340;
const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const ISO = "yyyy-MM-dd";

type Place = { left: number; top?: number; bottom?: number };

function parse(value: string): Date | null {
  if (!value) return null;
  const d = parseISO(value);
  return isValid(d) ? d : null;
}

/**
 * A date field in the app's own style instead of the browser's native calendar.
 * Closed, it matches every other form field (.input). Open, a month grid drops
 * from it (into <body>, so a card's backdrop-filter can't clip it, and upward
 * when there isn't room below).
 *
 * Keyboard: Enter, Space or the arrows open it; in the grid the arrows move by a
 * day or a week, PageUp and PageDown by a month, Enter or Space picks, Escape
 * closes.
 */
export default function DatePicker({
  value,
  onChange,
  id,
  disabled,
  className,
  placeholder = "Choose a date",
  ...aria
}: Props) {
  const dialogId = `date-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const selected = parse(value);
  const [open, setOpen] = useState(false);
  // The day the arrow keys act on; its month is the one on screen.
  const [cursor, setCursor] = useState<Date>(selected ?? new Date());
  const [place, setPlace] = useState<Place | null>(null);

  const measure = () => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - WIDTH - 8));
    const roomBelow = window.innerHeight - r.bottom;
    const up = roomBelow < HEIGHT + GAP && r.top > roomBelow;
    setPlace(
      up ? { left, bottom: window.innerHeight - r.top + GAP } : { left, top: r.bottom + GAP },
    );
  };

  const openPanel = () => {
    if (disabled) return;
    setCursor(selected ?? new Date());
    measure();
    setOpen(true);
  };

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };

  const pick = (day: Date) => {
    onChange(format(day, ISO));
    close();
  };

  // While open: follow the field on scroll or resize; close on a press outside.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!panelRef.current?.contains(t) && !triggerRef.current?.contains(t)) setOpen(false);
    };
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
    // measure only reads refs.
  }, [open]);

  // Keep keyboard focus on the day the cursor is on.
  useLayoutEffect(() => {
    if (!open) return;
    panelRef.current
      ?.querySelector<HTMLButtonElement>(`[data-day="${format(cursor, ISO)}"]`)
      ?.focus();
  }, [open, cursor]);

  const onTriggerKeyDown = (e: ReactKeyboardEvent) => {
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
      e.preventDefault();
      openPanel();
    }
  };

  const onGridKeyDown = (e: ReactKeyboardEvent) => {
    const step: Record<string, (d: Date) => Date> = {
      ArrowLeft: (d) => addDays(d, -1),
      ArrowRight: (d) => addDays(d, 1),
      ArrowUp: (d) => addDays(d, -7),
      ArrowDown: (d) => addDays(d, 7),
      PageUp: (d) => addMonths(d, -1),
      PageDown: (d) => addMonths(d, 1),
    };
    if (step[e.key]) {
      e.preventDefault();
      setCursor((d) => step[e.key](d));
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Tab") {
      close(false);
    }
  };

  const days = eachDayOfInterval({
    start: startOfWeek(startOfMonth(cursor)),
    end: endOfWeek(endOfMonth(cursor)),
  });
  const today = new Date();

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? dialogId : undefined}
        {...aria}
        onClick={() => (open ? close() : openPanel())}
        onKeyDown={onTriggerKeyDown}
        className={clsx(
          "input flex items-center gap-2 text-left disabled:cursor-not-allowed disabled:opacity-65",
          open && "!border-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.22)]",
          className,
        )}
      >
        <span className={clsx("flex-1 truncate", !selected && "text-muted")}>
          {selected ? format(selected, "MMM d, yyyy") : placeholder}
        </span>
        <Calendar
          size={16}
          aria-hidden
          className={clsx(
            "shrink-0",
            open ? "text-emerald-500" : "text-slate-500 dark:text-slate-400",
          )}
        />
      </button>

      {open &&
        place &&
        createPortal(
          <div
            ref={panelRef}
            id={dialogId}
            role="dialog"
            aria-label="Choose a date"
            className="fixed z-[70] rounded-xl bg-white p-3 shadow-2xl ring-1 ring-soft animate-panel-in dark:bg-slate-900"
            style={{ ...place, width: WIDTH }}
          >
            <div className="mb-2 flex items-center justify-between">
              <button
                type="button"
                aria-label="Previous month"
                onClick={() => setCursor((d) => addMonths(d, -1))}
                className="btn-ghost !p-1.5"
              >
                <ChevronLeft size={16} />
              </button>
              <span className="text-sm font-bold text-primary" aria-live="polite">
                {format(cursor, "MMMM yyyy")}
              </span>
              <button
                type="button"
                aria-label="Next month"
                onClick={() => setCursor((d) => addMonths(d, 1))}
                className="btn-ghost !p-1.5"
              >
                <ChevronRight size={16} />
              </button>
            </div>

            <div className="grid grid-cols-7 text-center text-[10px] font-bold uppercase tracking-wide text-muted">
              {WEEKDAYS.map((w) => (
                <span key={w} className="py-1">
                  {w}
                </span>
              ))}
            </div>

            <div role="grid" className="grid grid-cols-7 gap-0.5" onKeyDown={onGridKeyDown}>
              {days.map((day) => {
                const inMonth = isSameMonth(day, cursor);
                const isSelected = !!selected && isSameDay(day, selected);
                const isToday = isSameDay(day, today);
                const isCursor = isSameDay(day, cursor);
                return (
                  <button
                    key={day.toISOString()}
                    type="button"
                    data-day={format(day, ISO)}
                    tabIndex={isCursor ? 0 : -1}
                    aria-label={format(day, "EEEE, MMMM d, yyyy")}
                    aria-pressed={isSelected}
                    onClick={() => pick(day)}
                    className={clsx(
                      "h-9 rounded-lg text-sm tabular-nums transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400",
                      isSelected
                        ? "bg-grad-brand font-bold text-white shadow-grad-glow"
                        : inMonth
                          ? "text-primary hover:bg-slate-100 dark:hover:bg-slate-700/40"
                          : "text-muted opacity-60 hover:bg-slate-100 dark:hover:bg-slate-700/40",
                      isToday && !isSelected && "ring-1 ring-emerald-400",
                    )}
                  >
                    {format(day, "d")}
                  </button>
                );
              })}
            </div>

            <div className="mt-2 flex justify-between border-t border-slate-200 pt-2 dark:border-slate-700">
              <button type="button" onClick={() => pick(new Date())} className="btn-ghost text-xs">
                Today
              </button>
              <button type="button" onClick={() => close()} className="btn-ghost text-xs">
                Close
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
