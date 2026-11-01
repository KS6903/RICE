// A browser steps a focused number, date or time field, or a dropdown, when the
// wheel turns over it, so a scroll down the page can quietly change a figure.
// Here the wheel always scrolls the page instead. The field keeps its focus:
// blurring it would also run whatever saves on blur, half-typed value included.

const STEPPED_TYPES = new Set([
  "number",
  "date",
  "time",
  "datetime-local",
  "month",
  "week",
  "range",
]);

function stepsOnWheel(target: EventTarget | null): target is HTMLElement {
  if (target instanceof HTMLInputElement) return STEPPED_TYPES.has(target.type);
  // A list that shows several rows at once needs the wheel to scroll its rows.
  if (target instanceof HTMLSelectElement) return !target.multiple && target.size <= 1;
  return false;
}

// Canceling the wheel also cancels the scroll, so the scroll is redone here: the
// nearest thing behind the field that can still move takes it, like a real scroll.
function scrollBehind(field: Element, dx: number, dy: number) {
  for (let el = field.parentElement; el; el = el.parentElement) {
    const style = getComputedStyle(el);
    const scrolls = (overflow: string) =>
      /auto|scroll/.test(overflow) || (el === document.scrollingElement && overflow === "visible");
    const top = el.scrollTop;
    const left = el.scrollLeft;
    if (scrolls(style.overflowY)) el.scrollTop += dy;
    if (scrolls(style.overflowX)) el.scrollLeft += dx;
    if (el.scrollTop !== top || el.scrollLeft !== left) return;
    // A dialog's scroll never reaches the page behind it.
    if (style.position === "fixed") return;
    if (dy && style.overscrollBehaviorY !== "auto") return;
    if (dx && style.overscrollBehaviorX !== "auto") return;
  }
}

function scrollInstead(event: WheelEvent) {
  // Ctrl + wheel is the browser's zoom.
  if (event.ctrlKey) return;
  event.preventDefault();
  const unit =
    event.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? 16
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
        ? window.innerHeight
        : 1;
  scrollBehind(event.currentTarget as Element, event.deltaX * unit, event.deltaY * unit);
}

// Only a focused field steps, so only a focused field listens: a wheel listener
// that can cancel makes the browser wait for it before every scroll over it.
function onFocusIn(event: FocusEvent) {
  const field = event.target;
  if (!stepsOnWheel(field)) return;
  field.addEventListener("wheel", scrollInstead, { passive: false });
  field.addEventListener("focusout", () => field.removeEventListener("wheel", scrollInstead), {
    once: true,
  });
}

/** Covers every field in the app, now and later. Returns a function that stops it. */
export function protectFieldsFromWheel() {
  document.addEventListener("focusin", onFocusIn);
  return () => document.removeEventListener("focusin", onFocusIn);
}
