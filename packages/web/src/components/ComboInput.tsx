import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { clsx } from "clsx";

type Props = {
  value: string;
  onChange: (value: string) => void;
  /** Offered as the person types; anything else typed is still accepted. */
  suggestions: string[];
  /** For a <label htmlFor>. */
  id?: string;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  maxLength?: number;
  "aria-label"?: string;
};

const GAP = 6;
const ROW = 40;
const MAX_HEIGHT = 224; // max-h-56

type Place = { left: number; width: number; top?: number; bottom?: number };

/**
 * A text field with suggestions, in the app's own menu style instead of the
 * browser's native <datalist>. Typing narrows the list; the arrows move through
 * it and Enter takes one. Anything not in the list can still be typed.
 */
export default function ComboInput({
  value,
  onChange,
  suggestions,
  id,
  disabled,
  className,
  placeholder,
  maxLength,
  ...aria
}: Props) {
  const listId = `combo-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [place, setPlace] = useState<Place | null>(null);

  const typed = value.trim().toLowerCase();
  // An exact match has nothing left to offer.
  const matches = suggestions.filter((s) => {
    const lower = s.toLowerCase();
    return lower !== typed && lower.includes(typed);
  });
  const showing = open && matches.length > 0 && place !== null;

  const measure = () => {
    const r = inputRef.current?.getBoundingClientRect();
    if (!r) return;
    const menuHeight = Math.min(MAX_HEIGHT, matches.length * ROW + 8);
    const roomBelow = window.innerHeight - r.bottom;
    const up = roomBelow < menuHeight + GAP && r.top > roomBelow;
    setPlace(
      up
        ? { left: r.left, width: r.width, bottom: window.innerHeight - r.top + GAP }
        : { left: r.left, width: r.width, top: r.bottom + GAP },
    );
  };

  const show = () => {
    measure();
    setOpen(true);
  };

  const choose = (suggestion: string) => {
    onChange(suggestion);
    setOpen(false);
    setActive(-1);
  };

  // While showing: follow the field when anything scrolls or the window resizes.
  useEffect(() => {
    if (!showing) return;
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
    // measure only reads refs and the suggestions it is about to show.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showing]);

  useEffect(() => {
    if (showing && active >= 0)
      document.getElementById(`${listId}-${active}`)?.scrollIntoView?.({ block: "nearest" });
  }, [showing, active, listId]);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (!showing) show();
        setActive((i) => Math.min(i + 1, matches.length - 1));
        break;
      case "ArrowUp":
        if (showing) {
          e.preventDefault();
          setActive((i) => Math.max(i - 1, 0));
        }
        break;
      case "Enter":
        // Keep a form from submitting on the Enter that picks a suggestion.
        if (showing && active >= 0 && matches[active]) {
          e.preventDefault();
          choose(matches[active]);
        }
        break;
      case "Escape":
        if (showing) {
          e.preventDefault();
          e.stopPropagation();
          setOpen(false);
          setActive(-1);
        }
        break;
      case "Tab":
        setOpen(false);
        break;
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        id={id}
        type="text"
        role="combobox"
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={showing}
        aria-controls={showing ? listId : undefined}
        aria-activedescendant={showing && active >= 0 ? `${listId}-${active}` : undefined}
        {...aria}
        disabled={disabled}
        placeholder={placeholder}
        maxLength={maxLength}
        value={value}
        className={clsx("input", className)}
        onChange={(e) => {
          onChange(e.target.value);
          setActive(-1);
          show();
        }}
        onFocus={show}
        onBlur={() => {
          setOpen(false);
          setActive(-1);
        }}
        onKeyDown={onKeyDown}
      />

      {showing &&
        createPortal(
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            className="fixed z-[70] max-h-56 overflow-y-auto rounded-xl bg-white p-1 shadow-2xl ring-1 ring-soft outline-none animate-panel-in dark:bg-slate-900"
            style={place ?? undefined}
          >
            {matches.map((suggestion, i) => (
              <li
                key={suggestion}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                // Keep focus in the field, so a click doesn't blur it first.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(suggestion)}
                className={clsx(
                  "cursor-pointer truncate rounded-lg px-3 py-2.5 text-sm transition-colors",
                  i === active
                    ? "bg-slate-100 text-primary dark:bg-slate-700/40"
                    : "text-secondary",
                )}
              >
                {suggestion}
              </li>
            ))}
          </ul>,
          document.body,
        )}
    </>
  );
}
