type Viewport = { left: number; top: number; width: number; height: number };
type Anchor = Pick<DOMRect, "left" | "top" | "bottom">;

export function viewportBounds(): Viewport {
  const view = window.visualViewport;
  return {
    left: view?.offsetLeft ?? 0,
    top: view?.offsetTop ?? 0,
    width: view?.width ?? window.innerWidth,
    height: view?.height ?? window.innerHeight,
  };
}

/** Keep a portalled menu in the visible screen, including above a phone's keyboard. */
export function positionPopover(
  anchor: Anchor,
  width: number,
  height: number,
  view = viewportBounds(),
) {
  const margin = 8;
  const gap = 6;
  const availableWidth = Math.max(0, view.width - margin * 2);
  const availableHeight = Math.max(0, view.height - margin * 2);
  const above = Math.max(0, anchor.top - view.top - margin - gap);
  const below = Math.max(0, view.top + view.height - margin - anchor.bottom - gap);
  const up = below < height && above > below;
  const room = up ? above : below;
  // If neither side fits even a row, overlap the field rather than make the
  // choices unreachable (a keyboard or zoom can leave a very short viewport).
  const maxHeight = Math.min(height, availableHeight, room >= 42 ? room : availableHeight);
  const menuWidth = Math.min(width, availableWidth);
  return {
    left: Math.max(
      view.left + margin,
      Math.min(anchor.left, view.left + view.width - margin - menuWidth),
    ),
    top: Math.max(
      view.top + margin,
      Math.min(
        up ? anchor.top - gap - maxHeight : anchor.bottom + gap,
        view.top + view.height - margin - maxHeight,
      ),
    ),
    width: menuWidth,
    maxHeight,
  };
}

/** Follow page scrolling, rotation, browser zoom and the on-screen keyboard. */
export function observeViewport(measure: () => void) {
  const view = window.visualViewport;
  window.addEventListener("scroll", measure, true);
  window.addEventListener("resize", measure);
  view?.addEventListener("resize", measure);
  view?.addEventListener("scroll", measure);
  return () => {
    window.removeEventListener("scroll", measure, true);
    window.removeEventListener("resize", measure);
    view?.removeEventListener("resize", measure);
    view?.removeEventListener("scroll", measure);
  };
}
