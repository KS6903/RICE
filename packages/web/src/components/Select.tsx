import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import { clsx } from "clsx";
import { observeViewport, positionPopover } from "../utils/popoverPosition";
import { t } from "../i18n";

export type SelectOption = { value: string; label: string };

type Props = {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  /** For a <label htmlFor>. */
  id?: string;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  title?: string;
  "aria-label"?: string;
  "data-testid"?: string;
};

const ROW = 42;
const MAX_HEIGHT = 288; // max-h-72
const MAX_WIDTH = 448; // max-w-md

type Place = ReturnType<typeof positionPopover>;

/**
 * A dropdown in the app's own menu style (the look of the warehouse and
 * location pickers) instead of the browser's native list. Closed, it matches
 * every other form field (.input). Open, its menu is rendered into <body> so
 * a card's backdrop-filter or a page transform can't clip or bury it, and it
 * opens upward when there isn't room below.
 *
 * Keyboard: Enter, Space or the arrows open it; the arrows, Home and End move;
 * Enter or Space picks; Escape closes; typing a letter jumps to the next
 * option starting with it.
 */
export default function Select({
  value,
  onChange,
  options,
  id,
  disabled,
  className,
  placeholder = t("Choose…"),
  ...aria
}: Props) {
  // useId gives ":r0:"-style ids; keep them plain for aria references.
  const listId = `select-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [place, setPlace] = useState<Place | null>(null);

  const selectedIndex = options.findIndex((o) => o.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;

  const measure = () => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    const menuHeight = Math.min(MAX_HEIGHT, options.length * ROW + 8);
    setPlace(positionPopover(r, Math.min(MAX_WIDTH, Math.max(r.width, 240)), menuHeight));
  };

  const openMenu = () => {
    if (disabled || options.length === 0) return;
    measure();
    setActive(selectedIndex >= 0 ? selectedIndex : 0);
    setOpen(true);
  };

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };

  const choose = (index: number) => {
    const option = options[index];
    if (option) onChange(option.value);
    close();
  };

  // While open: follow the field when anything scrolls or the window resizes,
  // and close on a press outside the field and the menu.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!listRef.current?.contains(target) && !triggerRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", onPointerDown);
    const stop = observeViewport(measure);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      stop();
    };
    // measure only reads refs and options, which the menu doesn't change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Focus the menu as it opens, so the arrow keys work straight away.
  useLayoutEffect(() => {
    if (open) listRef.current?.focus();
  }, [open]);

  // Bring the chosen option to the middle of a long list as it opens, then keep
  // the highlighted one in view as the arrows move through it.
  const justOpened = useRef(false);
  useEffect(() => {
    if (!open) {
      justOpened.current = false;
      return;
    }
    const first = !justOpened.current;
    justOpened.current = true;
    document
      .getElementById(`${listId}-${active}`)
      ?.scrollIntoView?.({ block: first ? "center" : "nearest" });
  }, [open, active, listId]);

  const onTriggerKeyDown = (e: ReactKeyboardEvent) => {
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
      e.preventDefault();
      openMenu();
    }
  };

  const onListKeyDown = (e: ReactKeyboardEvent) => {
    const last = options.length - 1;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActive((i) => Math.min(i + 1, last));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActive((i) => Math.max(i - 1, 0));
        break;
      case "Home":
        e.preventDefault();
        setActive(0);
        break;
      case "End":
        e.preventDefault();
        setActive(last);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        choose(active);
        break;
      case "Escape":
        // Not passed on: a dialog around the field must stay open behind it.
        e.preventDefault();
        e.stopPropagation();
        close();
        break;
      case "Tab":
        close(false);
        break;
      default:
        // A letter jumps to the next option that starts with it.
        if (e.key.length === 1) {
          const key = e.key.toLowerCase();
          for (let step = 1; step <= options.length; step++) {
            const i = (active + step) % options.length;
            if (options[i].label.toLowerCase().startsWith(key)) {
              setActive(i);
              break;
            }
          }
        }
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        {...aria}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={onTriggerKeyDown}
        className={clsx(
          "input flex items-center gap-2 text-left disabled:cursor-not-allowed disabled:opacity-65",
          // Keep the focus ring while the menu (not the field) has focus.
          open && "!border-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.22)]",
          className,
        )}
      >
        <span className={clsx("flex-1 truncate", !selected && "text-muted")}>
          {selected?.label ?? placeholder}
        </span>
        <ChevronDown
          size={17}
          aria-hidden
          className={clsx(
            "shrink-0 transition-transform duration-150",
            open ? "rotate-180 text-emerald-500" : "text-slate-500 dark:text-slate-400",
          )}
        />
      </button>

      {open &&
        place &&
        createPortal(
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            tabIndex={-1}
            aria-labelledby={id}
            aria-label={id ? undefined : aria["aria-label"]}
            aria-activedescendant={`${listId}-${active}`}
            onKeyDown={onListKeyDown}
            className="fixed z-[70] max-h-72 overflow-y-auto rounded-xl bg-white p-1 shadow-2xl ring-1 ring-soft outline-none animate-panel-in dark:bg-slate-900"
            style={place}
          >
            {options.map((option, i) => {
              const isSelected = i === selectedIndex;
              const isActive = i === active;
              return (
                <li
                  key={option.value}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={isSelected}
                  onMouseEnter={() => setActive(i)}
                  // Keep focus in the menu, so a click doesn't blur it first.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(i)}
                  className={clsx(
                    "flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2.5 text-sm transition-colors",
                    isSelected
                      ? "font-semibold text-emerald-700 dark:text-emerald-300"
                      : "text-secondary",
                    isSelected
                      ? isActive
                        ? "bg-emerald-500/15"
                        : "bg-emerald-500/10"
                      : isActive && "bg-slate-100 text-primary dark:bg-slate-700/40",
                  )}
                >
                  <span className="flex-1 truncate">{option.label}</span>
                  {isSelected && <Check size={15} className="shrink-0" aria-hidden />}
                </li>
              );
            })}
          </ul>,
          document.body,
        )}
    </>
  );
}
