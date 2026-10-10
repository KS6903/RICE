import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { clsx } from "clsx";

type Props = {
  /** The full text. Shown in the cell cut short with "…" when it doesn't fit. */
  text: string;
  /** Sets the width it may take, e.g. "max-w-[12rem]". */
  className?: string;
  children?: ReactNode;
};

const HOLD_MS = 450;
const SHOW_MS = 3500;
const BUBBLE_WIDTH = 280;
const MARGIN = 8;

/**
 * Text that is cut short with "…" when it is too long for its cell, and shows
 * the whole of it on demand: hover (the browser's title tip) on a computer,
 * press and hold on a phone or tablet (touch has no hover, and a title tip
 * never shows there). The held text opens in a small bubble that closes after
 * a few seconds, or on the next touch or scroll.
 */
export default function TruncatedText({ text, className, children }: Props) {
  const ref = useRef<HTMLSpanElement>(null);
  const holdTimer = useRef<number | undefined>(undefined);
  const hideTimer = useRef<number | undefined>(undefined);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);

  const cancelHold = () => window.clearTimeout(holdTimer.current);

  const startHold = () => {
    cancelHold();
    holdTimer.current = window.setTimeout(() => {
      const r = ref.current?.getBoundingClientRect();
      if (!r) return;
      const room = window.innerWidth - BUBBLE_WIDTH - MARGIN;
      setPlace({ left: Math.max(MARGIN, Math.min(r.left, room)), top: r.bottom + 6 });
      window.clearTimeout(hideTimer.current);
      hideTimer.current = window.setTimeout(() => setPlace(null), SHOW_MS);
    }, HOLD_MS);
  };

  useEffect(
    () => () => {
      window.clearTimeout(holdTimer.current);
      window.clearTimeout(hideTimer.current);
    },
    [],
  );

  // While the bubble is open, the next touch anywhere else or a scroll closes it.
  useEffect(() => {
    if (!place) return;
    const onOutside = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) setPlace(null);
    };
    const onScroll = () => setPlace(null);
    window.addEventListener("touchstart", onOutside);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("touchstart", onOutside);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [place]);

  return (
    <>
      <span
        ref={ref}
        title={text}
        onTouchStart={startHold}
        onTouchEnd={cancelHold}
        onTouchMove={cancelHold}
        onTouchCancel={cancelHold}
        // The long press would otherwise open the phone's own text menu too.
        onContextMenu={(e) => {
          if (place) e.preventDefault();
        }}
        className={clsx(
          "block truncate [-webkit-touch-callout:none] [-webkit-user-select:none] select-none",
          className,
        )}
      >
        {children ?? text}
      </span>
      {place &&
        createPortal(
          <div
            role="tooltip"
            className="fixed z-[80] break-words rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white shadow-xl dark:bg-slate-700"
            style={{ left: place.left, top: place.top, maxWidth: BUBBLE_WIDTH }}
          >
            {text}
          </div>,
          document.body,
        )}
    </>
  );
}
