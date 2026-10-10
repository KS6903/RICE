import { useEffect, useRef } from "react";

// Every open popup or edit form registers here; Escape closes only the one that
// opened last, so a dialog on top of a form closes first and the form behind it
// stays put until the next press.
type Entry = { current: () => void };
const stack: Entry[] = [];
let attached = false;

function onKeyDown(e: KeyboardEvent) {
  // A dropdown or date picker that already used this Escape keeps it.
  if (e.key !== "Escape" || e.defaultPrevented) return;
  const top = stack[stack.length - 1];
  if (!top) return;
  e.preventDefault();
  top.current();
}

/**
 * Closes a popup, drawer or inline edit form when Escape is pressed.
 *
 * ``enabled`` is whether it is open: pass false while it is closed and it does
 * not take part. The handler may change between renders without re-registering.
 */
export function useEscapeKey(onEscape: () => void, enabled = true) {
  const handler = useRef(onEscape);
  handler.current = onEscape;

  useEffect(() => {
    if (!enabled) return;
    stack.push(handler);
    if (!attached) {
      window.addEventListener("keydown", onKeyDown);
      attached = true;
    }
    return () => {
      const i = stack.indexOf(handler);
      if (i >= 0) stack.splice(i, 1);
      if (stack.length === 0 && attached) {
        window.removeEventListener("keydown", onKeyDown);
        attached = false;
      }
    };
  }, [enabled]);
}
