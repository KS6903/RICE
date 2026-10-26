import { useEffect } from "react";
import { viewportBounds } from "../utils/popoverPosition";

/** Dialogs use the visible area when a keyboard covers part of the layout viewport. */
export function useVisualViewport() {
  useEffect(() => {
    const view = window.visualViewport;
    if (!view) return;
    const root = document.documentElement;
    let frame = 0;
    const update = () => {
      const bounds = viewportBounds();
      for (const [key, value] of Object.entries(bounds)) {
        root.style.setProperty(`--viewport-${key}`, `${value}px`);
      }
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    update();
    view.addEventListener("resize", schedule);
    view.addEventListener("scroll", schedule);
    return () => {
      cancelAnimationFrame(frame);
      view.removeEventListener("resize", schedule);
      view.removeEventListener("scroll", schedule);
      for (const key of ["left", "top", "width", "height"])
        root.style.removeProperty(`--viewport-${key}`);
    };
  }, []);
}
