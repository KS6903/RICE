import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { useAuthStore } from "../stores/authStore";

// Touch: press and hold this long before a drag starts, so a swipe along the tab
// bar still scrolls it.
const HOLD_MS = 300;
// Mouse: how far the pointer must travel before a press counts as a drag.
const MOVE_PX = 6;
// A click right after a drag is the end of that drag, not a choice of tab.
const CLICK_GRACE_MS = 250;

/** The saved order, with anything unknown dropped and anything new appended. */
export function normalizeOrder(saved: unknown, keys: readonly string[]): string[] {
  const known = Array.isArray(saved)
    ? saved.filter((k): k is string => typeof k === "string" && keys.includes(k))
    : [];
  const unique = [...new Set(known)];
  return [...unique, ...keys.filter((k) => !unique.includes(k))];
}

function moveItem(list: string[], from: number, to: number): string[] {
  if (from < 0 || to < 0 || from >= list.length || to >= list.length || from === to) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

function load(storageKey: string | null, keys: readonly string[]): string[] {
  if (!storageKey) return [...keys];
  try {
    return normalizeOrder(JSON.parse(localStorage.getItem(storageKey) ?? "null"), keys);
  } catch {
    return [...keys];
  }
}

type Press = {
  key: string;
  x: number;
  y: number;
  touch: boolean;
  active: boolean;
  timer?: number;
};

/**
 * Tabs the user can rearrange by dragging, and the order they leave them in.
 *
 * Mouse: press a tab and drag it past its neighbours. Touch: press and hold, then
 * drag. Keyboard: Alt + Left / Right on a focused tab. The order is saved under
 * the account's own key, so it outlasts signing out and is each person's own;
 * the first tab in it is the one a page should open on.
 *
 * Spread `containerProps` on the tab bar and `tabProps(key)` on each tab, and
 * ask `wasDragged()` in the tab's click handler so a drop doesn't also select it.
 */
export function useReorderableTabs(storageName: string, keys: readonly string[]) {
  const userId = useAuthStore((s) => s.user?.id);
  const storageKey = userId ? `${storageName}:${userId}` : null;
  const keysId = keys.join("|");

  const [order, setOrder] = useState<string[]>(() => load(storageKey, keys));
  const [dragging, setDragging] = useState<string | null>(null);

  const orderRef = useRef(order);
  orderRef.current = order;
  const containerRef = useRef<HTMLElement | null>(null);
  const press = useRef<Press | null>(null);
  const droppedAt = useRef(0);

  // Another account signing in on this browser gets its own order.
  useEffect(() => {
    setOrder(load(storageKey, keys));
    // keys is a constant list; keysId stands in for it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey, keysId]);

  const save = useCallback(
    (next: string[]) => {
      if (!storageKey) return;
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        // Storage blocked (private mode): the order lasts until the tab closes.
      }
    },
    [storageKey],
  );

  // The pointer handlers outlive a render, so they reach the current save through a ref.
  const saveRef = useRef(save);
  saveRef.current = save;

  // The tab under the pointer decides where the dragged one goes: its index is
  // the number of other tabs whose centre is to the left of the pointer.
  const follow = useCallback((clientX: number) => {
    const p = press.current;
    const bar = containerRef.current;
    if (!p || !bar) return;
    let to = 0;
    bar.querySelectorAll<HTMLElement>("[data-tab-key]").forEach((el) => {
      if (el.dataset.tabKey === p.key) return;
      const r = el.getBoundingClientRect();
      if (clientX > r.left + r.width / 2) to += 1;
    });
    const current = orderRef.current;
    const next = moveItem(current, current.indexOf(p.key), to);
    if (next !== current) {
      orderRef.current = next;
      setOrder(next);
    }
  }, []);

  const beginDrag = useCallback(() => {
    const p = press.current;
    if (!p || p.active) return;
    p.active = true;
    setDragging(p.key);
  }, []);

  const onMove = useCallback(
    (e: PointerEvent) => {
      const p = press.current;
      if (!p) return;
      if (!p.active) {
        const far = Math.hypot(e.clientX - p.x, e.clientY - p.y) > MOVE_PX;
        if (!far) return;
        if (p.touch) {
          // Moved before the hold finished: the user is scrolling the bar.
          stop(false);
          return;
        }
        beginDrag();
      }
      follow(e.clientX);
    },
    // stop is declared below and only reads refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [beginDrag, follow],
  );

  const blockScroll = useCallback((e: TouchEvent) => {
    if (press.current?.active && e.cancelable) e.preventDefault();
  }, []);

  const onUp = useCallback(() => stop(true), []); // eslint-disable-line react-hooks/exhaustive-deps

  function stop(commit: boolean) {
    const p = press.current;
    if (!p) return;
    window.clearTimeout(p.timer);
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    window.removeEventListener("touchmove", blockScroll);
    press.current = null;
    if (p.active) {
      droppedAt.current = Date.now();
      setDragging(null);
      if (commit) saveRef.current(orderRef.current);
    }
  }

  // A drag still going when the page goes away must not leave listeners behind.
  useEffect(() => () => stop(false), []); // eslint-disable-line react-hooks/exhaustive-deps

  const tabProps = useCallback(
    (key: string) => ({
      "data-tab-key": key,
      onPointerDown: (e: ReactPointerEvent) => {
        if (e.button !== 0 || press.current) return;
        const touch = e.pointerType === "touch" || e.pointerType === "pen";
        press.current = { key, x: e.clientX, y: e.clientY, touch, active: false };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        window.addEventListener("pointercancel", onUp);
        if (touch) {
          window.addEventListener("touchmove", blockScroll, { passive: false });
          press.current.timer = window.setTimeout(beginDrag, HOLD_MS);
        }
      },
      // A long press would otherwise open the phone's own menu.
      onContextMenu: (e: { preventDefault: () => void }) => {
        if (press.current?.touch) e.preventDefault();
      },
      onKeyDown: (e: KeyboardEvent) => {
        if (!e.altKey || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
        e.preventDefault();
        const current = orderRef.current;
        const from = current.indexOf(key);
        const next = moveItem(current, from, from + (e.key === "ArrowLeft" ? -1 : 1));
        if (next !== current) {
          orderRef.current = next;
          setOrder(next);
          save(next);
        }
      },
    }),
    [beginDrag, blockScroll, onMove, onUp, save],
  );

  const containerProps = useMemo(
    () => ({
      ref: (el: HTMLElement | null) => {
        containerRef.current = el;
      },
    }),
    [],
  );

  const wasDragged = useCallback(() => Date.now() - droppedAt.current < CLICK_GRACE_MS, []);

  return { order, dragging, tabProps, containerProps, wasDragged };
}
