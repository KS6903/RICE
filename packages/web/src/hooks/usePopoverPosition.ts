import { useLayoutEffect, useState, type RefObject } from "react";
import { observeViewport, positionPopover } from "../utils/popoverPosition";

/** Coordinates for a menu portalled out of a glass/scrolling container. */
export function usePopoverPosition(
  open: boolean,
  trigger: RefObject<HTMLElement>,
  popup: RefObject<HTMLElement>,
  width: number,
  height: number,
) {
  const [place, setPlace] = useState<ReturnType<typeof positionPopover> | null>(null);
  const mounted = place !== null;
  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const anchor = trigger.current?.getBoundingClientRect();
      if (!anchor) return;
      const contentHeight = popup.current?.scrollHeight || height;
      const next = positionPopover(anchor, width, Math.min(height, contentHeight));
      setPlace((previous) =>
        previous &&
        Object.entries(next).every(([key, value]) => previous[key as keyof typeof next] === value)
          ? previous
          : next,
      );
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    if (popup.current) {
      observer?.observe(popup.current);
      // An async list can grow while the panel is capped by its first height.
      // Observe its sections too, so the menu can use newly available room.
      for (const section of popup.current.children) observer?.observe(section);
    }
    const stop = observeViewport(measure);
    return () => {
      observer?.disconnect();
      stop();
    };
  }, [open, trigger, popup, width, height, mounted]);
  return place;
}
