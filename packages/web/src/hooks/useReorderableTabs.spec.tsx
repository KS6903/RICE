import { beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useAuthStore } from "../stores/authStore";
import { normalizeOrder, useReorderableTabs } from "./useReorderableTabs";

const KEYS = ["cards", "bins", "warehouse"] as const;
const STORE = "test-tabs";

function Bar() {
  const tabs = useReorderableTabs(STORE, KEYS);
  return (
    <div {...tabs.containerProps} data-testid="bar">
      {tabs.order.map((key) => (
        <button
          key={key}
          {...tabs.tabProps(key)}
          onClick={() => {
            if (!tabs.wasDragged()) document.body.dataset.picked = key;
          }}
        >
          {key}
        </button>
      ))}
      <span data-testid="dragging">{tabs.dragging ?? ""}</span>
    </div>
  );
}

// What the tabs saved (the auth store keeps its own entry in the same storage).
const tabKeys = () => Object.keys(localStorage).filter((k) => k.startsWith(STORE));
const order = () => screen.getAllByRole("button").map((b) => b.textContent);
const signIn = (id: string) => useAuthStore.setState({ user: { id } as any });

/** Lay the tabs out 100px wide each, left to right, in their current order. */
function layOut() {
  screen.getAllByRole("button").forEach((el, i) => {
    el.getBoundingClientRect = () =>
      ({
        left: i * 100,
        width: 100,
        right: i * 100 + 100,
        top: 0,
        bottom: 30,
        height: 30,
      }) as DOMRect;
  });
}

// jsdom has no PointerEvent, so the pointer events are mouse events with a pointer name.
const pointer = (type: string, init: MouseEventInit, target: EventTarget = window) =>
  act(() => {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0, ...init }));
  });

describe("normalizeOrder", () => {
  it("drops unknown tabs, keeps the saved order, and appends new ones", () => {
    expect(normalizeOrder(["bins", "gone", "cards"], KEYS)).toEqual(["bins", "cards", "warehouse"]);
  });
  it("falls back to the default order for junk", () => {
    expect(normalizeOrder("nope", KEYS)).toEqual([...KEYS]);
    expect(normalizeOrder(null, KEYS)).toEqual([...KEYS]);
  });
  it("ignores a repeated tab", () => {
    expect(normalizeOrder(["bins", "bins"], KEYS)).toEqual(["bins", "cards", "warehouse"]);
  });
});

describe("useReorderableTabs", () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.body.dataset.picked;
    signIn("owner-1");
  });

  it("starts in the default order", () => {
    render(<Bar />);
    expect(order()).toEqual(["cards", "bins", "warehouse"]);
  });

  it("moves a tab with Alt + arrow keys, and remembers it for the account", () => {
    const first = render(<Bar />);
    fireEvent.keyDown(screen.getByText("cards"), { key: "ArrowRight", altKey: true });
    expect(order()).toEqual(["bins", "cards", "warehouse"]);
    first.unmount();

    // A later visit, after signing out and back in.
    useAuthStore.setState({ user: null });
    signIn("owner-1");
    render(<Bar />);
    expect(order()).toEqual(["bins", "cards", "warehouse"]);
  });

  it("keeps each account's order separate", () => {
    const owner = render(<Bar />);
    fireEvent.keyDown(screen.getByText("cards"), { key: "ArrowRight", altKey: true });
    owner.unmount();

    signIn("cashier-1");
    render(<Bar />);
    expect(order()).toEqual(["cards", "bins", "warehouse"]);
  });

  it("never hands one account's order to another, even with the page left open", () => {
    render(<Bar />);
    fireEvent.keyDown(screen.getByText("cards"), { key: "ArrowRight", altKey: true });
    const ownerSaved = localStorage.getItem(`${STORE}:owner-1`);
    expect(JSON.parse(ownerSaved!)).toEqual(["bins", "cards", "warehouse"]);

    // Someone else signs in on this browser while the page stays mounted.
    act(() => signIn("cashier-1"));
    expect(order()).toEqual(["cards", "bins", "warehouse"]);
    // Showing it does not write anything for the newcomer...
    expect(localStorage.getItem(`${STORE}:cashier-1`)).toBeNull();

    // ...their own change is saved under their own key only...
    fireEvent.keyDown(screen.getByText("warehouse"), { key: "ArrowLeft", altKey: true });
    expect(order()).toEqual(["cards", "warehouse", "bins"]);
    expect(JSON.parse(localStorage.getItem(`${STORE}:cashier-1`)!)).toEqual([
      "cards",
      "warehouse",
      "bins",
    ]);
    // ...and the first account's saved order is untouched.
    expect(localStorage.getItem(`${STORE}:owner-1`)).toBe(ownerSaved);

    // Back to the first account: its own order returns.
    act(() => signIn("owner-1"));
    expect(order()).toEqual(["bins", "cards", "warehouse"]);
  });

  it("uses no device-wide key that every account would share", () => {
    render(<Bar />);
    fireEvent.keyDown(screen.getByText("cards"), { key: "ArrowRight", altKey: true });
    expect(tabKeys()).toEqual([`${STORE}:owner-1`]);
  });

  it("does not save anything while nobody is signed in", () => {
    useAuthStore.setState({ user: null });
    render(<Bar />);
    fireEvent.keyDown(screen.getByText("cards"), { key: "ArrowRight", altKey: true });
    expect(tabKeys()).toEqual([]);
  });

  it("does not move past either end", () => {
    render(<Bar />);
    fireEvent.keyDown(screen.getByText("cards"), { key: "ArrowLeft", altKey: true });
    fireEvent.keyDown(screen.getByText("warehouse"), { key: "ArrowRight", altKey: true });
    expect(order()).toEqual(["cards", "bins", "warehouse"]);
  });

  it("drags a tab past its neighbours with the mouse and saves where it was dropped", () => {
    render(<Bar />);
    layOut();

    pointer("pointerdown", { clientX: 50, clientY: 10 }, screen.getByText("cards"));
    pointer("pointermove", { clientX: 160, clientY: 10 });
    expect(screen.getByTestId("dragging").textContent).toBe("cards");
    expect(order()).toEqual(["bins", "cards", "warehouse"]);

    layOut();
    pointer("pointermove", { clientX: 280, clientY: 10 });
    expect(order()).toEqual(["bins", "warehouse", "cards"]);

    pointer("pointerup", { clientX: 280, clientY: 10 });
    expect(screen.getByTestId("dragging").textContent).toBe("");
    expect(JSON.parse(localStorage.getItem(`${STORE}:owner-1`)!)).toEqual([
      "bins",
      "warehouse",
      "cards",
    ]);

    // The click that ends a drag must not also pick the tab.
    fireEvent.click(screen.getByText("cards"));
    expect(document.body.dataset.picked).toBeUndefined();
  });

  it("treats a press without movement as a normal click", () => {
    render(<Bar />);
    layOut();
    pointer("pointerdown", { clientX: 150, clientY: 10 }, screen.getByText("bins"));
    pointer("pointerup", { clientX: 150, clientY: 10 });
    fireEvent.click(screen.getByText("bins"));
    expect(document.body.dataset.picked).toBe("bins");
    expect(order()).toEqual(["cards", "bins", "warehouse"]);
  });
});
