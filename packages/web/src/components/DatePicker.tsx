import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Calendar, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { clsx } from "clsx";
import {
  addDays,
  addMonths,
  addYears,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isAfter,
  isBefore,
  isSameDay,
  isSameMonth,
  isValid,
  parseISO,
  setMonth,
  setYear,
  startOfDay,
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
  /** Earliest and latest day that can be picked, "yyyy-MM-dd". */
  min?: string;
  max?: string;
  /** Adds a Clear button, for a field that may be left empty. */
  clearable?: boolean;
  "aria-label"?: string;
  "data-testid"?: string;
};

const GAP = 6;
const WIDTH = 288; // w-72
const HEIGHT = 376;
const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const ISO = "yyyy-MM-dd";
const YEARS_PER_PAGE = 12;

type Place = { left: number; top?: number; bottom?: number };
type View = "days" | "months" | "years";

function parse(value: string | undefined): Date | null {
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
 * The month and year in its header open a month chooser, and the year in that
 * one a year chooser, so a birthdate is three taps away rather than hundreds
 * of months.
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
  min,
  max,
  clearable = false,
  ...aria
}: Props) {
  const dialogId = `date-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const lastView = useRef<View>("days");
  const selected = parse(value);
  const minDate = parse(min);
  const maxDate = parse(max);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("days");
  // The day the arrow keys act on; its month is the one on screen.
  const [cursor, setCursor] = useState<Date>(startOfDay(selected ?? new Date()));
  const [place, setPlace] = useState<Place | null>(null);

  const outOfRange = (day: Date) =>
    (!!minDate && isBefore(day, minDate)) || (!!maxDate && isAfter(day, maxDate));
  // A whole month or year is out of range when its first and last days both are.
  const spanOutOfRange = (first: Date, last: Date) =>
    (!!minDate && isBefore(last, minDate)) || (!!maxDate && isAfter(first, maxDate));
  const clamp = (day: Date) => {
    if (minDate && isBefore(day, minDate)) return minDate;
    if (maxDate && isAfter(day, maxDate)) return maxDate;
    return day;
  };

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
    setCursor(clamp(startOfDay(selected ?? new Date())));
    setView("days");
    lastView.current = "days";
    measure();
    setOpen(true);
  };

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };

  const pick = (day: Date) => {
    if (outOfRange(day)) return;
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

  // Keep keyboard focus on the cell the cursor is on: as the panel opens, as the
  // view changes, and while the arrows are moving through the grid. Not when a
  // mouse press on Previous or Next just changed the month.
  useLayoutEffect(() => {
    if (!open) return;
    const viewChanged = lastView.current !== view;
    lastView.current = view;
    const active = document.activeElement;
    const inBody = !!bodyRef.current?.contains(active);
    const outsidePanel = !panelRef.current?.contains(active);
    if (viewChanged || inBody || outsidePanel) {
      bodyRef.current?.querySelector<HTMLButtonElement>("[data-cursor]")?.focus();
    }
  }, [open, cursor, view]);

  const onTriggerKeyDown = (e: ReactKeyboardEvent) => {
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
      e.preventDefault();
      openPanel();
    }
  };

  // The arrows, per view: a day and a week, a month and a row of months, a year
  // and a row of years. PageUp and PageDown take the next larger step.
  const onBodyKeyDown = (e: ReactKeyboardEvent) => {
    const steps: Record<View, Record<string, (d: Date) => Date>> = {
      days: {
        ArrowLeft: (d) => addDays(d, -1),
        ArrowRight: (d) => addDays(d, 1),
        ArrowUp: (d) => addDays(d, -7),
        ArrowDown: (d) => addDays(d, 7),
        PageUp: (d) => addMonths(d, -1),
        PageDown: (d) => addMonths(d, 1),
      },
      months: {
        ArrowLeft: (d) => addMonths(d, -1),
        ArrowRight: (d) => addMonths(d, 1),
        ArrowUp: (d) => addMonths(d, -3),
        ArrowDown: (d) => addMonths(d, 3),
        PageUp: (d) => addYears(d, -1),
        PageDown: (d) => addYears(d, 1),
      },
      years: {
        ArrowLeft: (d) => addYears(d, -1),
        ArrowRight: (d) => addYears(d, 1),
        ArrowUp: (d) => addYears(d, -3),
        ArrowDown: (d) => addYears(d, 3),
        PageUp: (d) => addYears(d, -YEARS_PER_PAGE),
        PageDown: (d) => addYears(d, YEARS_PER_PAGE),
      },
    };
    const step = steps[view][e.key];
    if (step) {
      e.preventDefault();
      setCursor((d) => clamp(step(d)));
    } else if (e.key === "Tab") {
      close(false);
    }
  };

  // Escape closes from anywhere in the panel, and is not passed on, so a form
  // or dialog around the field stays open behind it.
  const onPanelKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    close();
  };

  const today = startOfDay(new Date());
  const cursorYear = cursor.getFullYear();
  const pageStart = cursorYear - (cursorYear % YEARS_PER_PAGE);

  // What Previous, Next and the title do depend on the view.
  const stepBack = () =>
    setCursor((d) =>
      view === "days" ? addMonths(d, -1) : addYears(d, view === "months" ? -1 : -YEARS_PER_PAGE),
    );
  const stepForward = () =>
    setCursor((d) =>
      view === "days" ? addMonths(d, 1) : addYears(d, view === "months" ? 1 : YEARS_PER_PAGE),
    );
  const unit = view === "days" ? "month" : view === "months" ? "year" : "years";

  const cell =
    "rounded-lg text-sm tabular-nums transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:cursor-not-allowed disabled:opacity-30";
  const idle =
    "text-primary hover:bg-slate-100 dark:hover:bg-slate-700/40 disabled:hover:bg-transparent";
  const chosen = "bg-grad-brand font-bold text-white shadow-grad-glow";

  const days = eachDayOfInterval({
    start: startOfWeek(startOfMonth(cursor)),
    end: endOfWeek(endOfMonth(cursor)),
  });

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
            onKeyDown={onPanelKeyDown}
          >
            <div className="mb-2 flex items-center justify-between gap-1">
              <button
                type="button"
                aria-label={`Previous ${unit}`}
                onClick={stepBack}
                className="btn-ghost !p-1.5"
              >
                <ChevronLeft size={16} />
              </button>
              {view === "years" ? (
                <span className="text-sm font-bold tabular-nums text-primary">
                  {pageStart} to {pageStart + YEARS_PER_PAGE - 1}
                </span>
              ) : (
                <button
                  type="button"
                  aria-label={view === "days" ? "Choose month and year" : "Choose year"}
                  onClick={() => setView(view === "days" ? "months" : "years")}
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm font-bold text-primary transition-colors hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 dark:hover:bg-slate-700/40"
                >
                  {view === "days" ? format(cursor, "MMMM yyyy") : cursorYear}
                  <ChevronDown size={14} aria-hidden className="text-slate-500" />
                </button>
              )}
              <button
                type="button"
                aria-label={`Next ${unit}`}
                onClick={stepForward}
                className="btn-ghost !p-1.5"
              >
                <ChevronRight size={16} />
              </button>
            </div>

            {/* One fixed height for all three views, so the panel never jumps. */}
            <div ref={bodyRef} className="h-[252px]" onKeyDown={onBodyKeyDown}>
              {view === "days" && (
                <>
                  <div className="grid grid-cols-7 text-center text-[10px] font-bold uppercase tracking-wide text-muted">
                    {WEEKDAYS.map((w) => (
                      <span key={w} className="py-1">
                        {w}
                      </span>
                    ))}
                  </div>
                  <div
                    role="group"
                    aria-label={format(cursor, "MMMM yyyy")}
                    className="grid grid-cols-7 gap-0.5"
                  >
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
                          data-cursor={isCursor || undefined}
                          tabIndex={isCursor ? 0 : -1}
                          disabled={outOfRange(day)}
                          aria-label={format(day, "EEEE, MMMM d, yyyy")}
                          aria-pressed={isSelected}
                          onClick={() => pick(day)}
                          className={clsx(
                            cell,
                            "h-9",
                            isSelected
                              ? chosen
                              : inMonth
                                ? idle
                                : clsx(idle, "!text-muted opacity-60"),
                            isToday && !isSelected && "ring-1 ring-emerald-400",
                          )}
                        >
                          {format(day, "d")}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}

              {view === "months" && (
                <div
                  role="group"
                  aria-label={String(cursorYear)}
                  className="grid grid-cols-3 gap-2 pt-1"
                >
                  {Array.from({ length: 12 }, (_, m) => {
                    const month = setMonth(startOfMonth(cursor), m);
                    const isSelected = !!selected && isSameMonth(month, selected);
                    const isCursor = m === cursor.getMonth();
                    return (
                      <button
                        key={m}
                        type="button"
                        data-month={format(month, "yyyy-MM")}
                        data-cursor={isCursor || undefined}
                        tabIndex={isCursor ? 0 : -1}
                        disabled={spanOutOfRange(month, endOfMonth(month))}
                        aria-pressed={isSelected}
                        onClick={() => {
                          setCursor((d) => clamp(setMonth(d, m)));
                          setView("days");
                        }}
                        className={clsx(
                          cell,
                          "h-[54px] font-medium",
                          isSelected ? chosen : idle,
                          isSameMonth(month, today) && !isSelected && "ring-1 ring-emerald-400",
                        )}
                      >
                        {format(month, "MMM")}
                      </button>
                    );
                  })}
                </div>
              )}

              {view === "years" && (
                <div role="group" aria-label="Years" className="grid grid-cols-3 gap-2 pt-1">
                  {Array.from({ length: YEARS_PER_PAGE }, (_, i) => {
                    const year = pageStart + i;
                    const first = new Date(year, 0, 1);
                    const isSelected = !!selected && selected.getFullYear() === year;
                    const isCursor = year === cursorYear;
                    return (
                      <button
                        key={year}
                        type="button"
                        data-year={year}
                        data-cursor={isCursor || undefined}
                        tabIndex={isCursor ? 0 : -1}
                        disabled={spanOutOfRange(first, new Date(year, 11, 31))}
                        aria-pressed={isSelected}
                        onClick={() => {
                          setCursor((d) => clamp(setYear(d, year)));
                          setView("months");
                        }}
                        className={clsx(
                          cell,
                          "h-[54px] font-medium",
                          isSelected ? chosen : idle,
                          year === today.getFullYear() && !isSelected && "ring-1 ring-emerald-400",
                        )}
                      >
                        {year}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="mt-2 flex items-center justify-between border-t border-slate-200 pt-2 dark:border-slate-700">
              <button
                type="button"
                disabled={outOfRange(today)}
                onClick={() => pick(today)}
                className="btn-ghost text-xs disabled:cursor-not-allowed disabled:opacity-40"
              >
                Today
              </button>
              <div className="flex items-center gap-1">
                {clearable && selected && (
                  <button
                    type="button"
                    onClick={() => {
                      onChange("");
                      close();
                    }}
                    className="btn-ghost text-xs"
                  >
                    Clear
                  </button>
                )}
                <button type="button" onClick={() => close()} className="btn-ghost text-xs">
                  Close
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
