import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Calendar, ChevronLeft, ChevronRight } from "lucide-react";
import { clsx } from "clsx";
import {
  addMonths,
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
  startOfMonth,
  startOfWeek,
  subDays,
} from "date-fns";
import { observeViewport, positionPopover } from "../utils/popoverPosition";
import { WEEKDAYS } from "../utils/weekdays";
import { t } from "../i18n";

type Props = {
  /** "yyyy-MM-dd", both ends included. */
  start: string;
  end: string;
  onChange: (start: string, end: string) => void;
  className?: string;
  "aria-label"?: string;
};

const WIDTH = 288; // w-72
const HEIGHT = 400;
const ISO = "yyyy-MM-dd";

type Place = ReturnType<typeof positionPopover>;

const parse = (value: string): Date | null => {
  const d = value ? parseISO(value) : null;
  return d && isValid(d) ? d : null;
};

/** "Oct 1 to Oct 31, 2026"; the year on both ends only when they differ. */
const rangeText = (from: Date, to: Date) =>
  t("{{start}} to {{end}}", {
    start: format(from, from.getFullYear() === to.getFullYear() ? "MMM d" : "MMM d, yyyy"),
    end: format(to, "MMM d, yyyy"),
  });

/**
 * One calendar for a period, in place of a From field and a To field. The first
 * day tapped starts the period and the second ends it, whichever order they come
 * in, and only then does the page hear of it, so it never loads half a period.
 */
export default function DateRangePicker({ start, end, onChange, className, ...aria }: Props) {
  const dialogId = `range-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const from = parse(start);
  const to = parse(end);
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(startOfMonth(from ?? new Date()));
  // The first day tapped, while the second is awaited; and the day being pointed at.
  const [first, setFirst] = useState<Date | null>(null);
  const [hover, setHover] = useState<Date | null>(null);
  const [place, setPlace] = useState<Place | null>(null);

  const measure = () => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (r) setPlace(positionPopover(r, WIDTH, HEIGHT));
  };

  const openPanel = () => {
    setMonth(startOfMonth(from ?? new Date()));
    setFirst(null);
    setHover(null);
    measure();
    setOpen(true);
  };

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const apply = (a: Date, b: Date) => {
    const [earlier, later] = isAfter(a, b) ? [b, a] : [a, b];
    onChange(format(earlier, ISO), format(later, ISO));
    close();
  };

  const pick = (day: Date) => {
    if (first) apply(first, day);
    else setFirst(day);
  };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!panelRef.current?.contains(target) && !triggerRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", onPointerDown);
    const stop = observeViewport(measure);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      stop();
    };
    // measure only reads refs.
  }, [open]);

  // Escape closes the panel only, so a dialog around the field stays open behind it.
  const onPanelKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    close();
  };

  // What the grid shows as chosen: the second end follows the pointer while picking.
  const other = first ? (hover ?? first) : null;
  const shownFrom = first && other ? (isAfter(first, other) ? other : first) : from;
  const shownTo = first && other ? (isAfter(first, other) ? first : other) : to;

  const today = new Date();
  const days = eachDayOfInterval({
    start: startOfWeek(startOfMonth(month)),
    end: endOfWeek(endOfMonth(month)),
  });
  const presets = [
    { label: t("This month"), from: startOfMonth(today), to: today },
    {
      label: t("Last month"),
      from: startOfMonth(addMonths(today, -1)),
      to: endOfMonth(addMonths(today, -1)),
    },
    { label: t("Last 90 days"), from: subDays(today, 89), to: today },
  ];

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? dialogId : undefined}
        {...aria}
        onClick={() => (open ? close() : openPanel())}
        className={clsx(
          "input flex items-center gap-2 text-left",
          open && "!border-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.22)]",
          className,
        )}
      >
        <span className="flex-1 truncate tabular-nums">
          {from && to ? rangeText(from, to) : t("Choose dates")}
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
            aria-label={t("Choose dates")}
            className="fixed z-[70] overflow-y-auto overscroll-contain rounded-xl bg-white p-3 shadow-2xl ring-1 ring-soft animate-panel-in dark:bg-slate-900"
            style={place}
            onKeyDown={onPanelKeyDown}
          >
            <div className="mb-2 flex items-center justify-between gap-1">
              <button
                type="button"
                aria-label={t("Previous {{unit}}", { unit: "month" })}
                onClick={() => setMonth((m) => addMonths(m, -1))}
                className="btn-ghost !p-1.5"
              >
                <ChevronLeft size={16} />
              </button>
              <span className="text-sm font-bold text-primary">{format(month, "MMMM yyyy")}</span>
              <button
                type="button"
                aria-label={t("Next {{unit}}", { unit: "month" })}
                onClick={() => setMonth((m) => addMonths(m, 1))}
                className="btn-ghost !p-1.5"
              >
                <ChevronRight size={16} />
              </button>
            </div>

            <div className="grid grid-cols-7 text-center text-[10px] font-bold uppercase tracking-wide text-muted">
              {WEEKDAYS.map((w, i) => (
                <span key={i} className="py-1">
                  {w}
                </span>
              ))}
            </div>
            <div
              role="group"
              aria-label={format(month, "MMMM yyyy")}
              className="grid grid-cols-7 gap-y-0.5"
              onMouseLeave={() => setHover(null)}
            >
              {days.map((day) => {
                const isEnd =
                  (!!shownFrom && isSameDay(day, shownFrom)) ||
                  (!!shownTo && isSameDay(day, shownTo));
                const inside =
                  !!shownFrom && !!shownTo && isAfter(day, shownFrom) && isBefore(day, shownTo);
                return (
                  <button
                    key={day.toISOString()}
                    type="button"
                    data-day={format(day, ISO)}
                    aria-label={format(day, "EEEE, MMMM d, yyyy")}
                    aria-pressed={isEnd || inside}
                    onClick={() => pick(day)}
                    onMouseEnter={() => setHover(day)}
                    className={clsx(
                      "h-9 text-sm tabular-nums transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400",
                      isEnd
                        ? "rounded-lg bg-grad-brand font-bold text-white shadow-grad-glow"
                        : inside
                          ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100"
                          : clsx(
                              "rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700/40",
                              isSameMonth(day, month) ? "text-primary" : "text-muted opacity-60",
                            ),
                      !isEnd && isSameDay(day, today) && "ring-1 ring-emerald-400",
                    )}
                  >
                    {format(day, "d")}
                  </button>
                );
              })}
            </div>

            <p className="mt-2 text-center text-xs text-muted" aria-live="polite">
              {first ? t("Now tap the last day.") : t("Tap the first day.")}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-slate-200 pt-2 dark:border-slate-700">
              {presets.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => apply(p.from, p.to)}
                  className="btn-ghost text-xs"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
