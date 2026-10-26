import { describe, expect, it } from "vitest";
import { positionPopover } from "./popoverPosition";

const phone = { left: 0, top: 0, width: 320, height: 640 };

describe("popover bounds", () => {
  it("keeps a wide menu on screen when its trigger is at the right edge", () => {
    const menu = positionPopover({ left: 260, top: 50, bottom: 94 }, 384, 440, phone);
    expect(menu.left).toBeGreaterThanOrEqual(8);
    expect(menu.left + menu.width).toBeLessThanOrEqual(phone.width - 8);
  });

  it("puts a calendar above a field near the bottom of the screen", () => {
    const anchor = { left: 16, top: 550, bottom: 594 };
    const menu = positionPopover(anchor, 288, 376, phone);
    expect(menu.top + menu.maxHeight).toBeLessThan(anchor.top);
  });

  it("keeps all choices scrollable within the area above an on-screen keyboard", () => {
    const keyboard = { left: 0, top: 170, width: 320, height: 210 };
    const menu = positionPopover({ left: 20, top: 270, bottom: 314 }, 288, 376, keyboard);
    expect(menu.top).toBeGreaterThanOrEqual(keyboard.top + 8);
    expect(menu.top + menu.maxHeight).toBeLessThanOrEqual(keyboard.top + keyboard.height - 8);
    expect(menu.maxHeight).toBeGreaterThan(42);
  });

  it("allows scrolling even when a zoomed field occupies nearly the whole viewport", () => {
    const zoomed = { left: 80, top: 100, width: 180, height: 100 };
    const menu = positionPopover({ left: 20, top: 105, bottom: 190 }, 448, 288, zoomed);
    expect(menu.width).toBeLessThanOrEqual(zoomed.width - 16);
    expect(menu.maxHeight).toBeGreaterThan(42);
    expect(menu.top).toBeGreaterThanOrEqual(zoomed.top + 8);
    expect(menu.top + menu.maxHeight).toBeLessThanOrEqual(zoomed.top + zoomed.height - 8);
  });
});
