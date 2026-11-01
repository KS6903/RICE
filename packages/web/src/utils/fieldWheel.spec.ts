import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { protectFieldsFromWheel } from "./fieldWheel";

function wheel(target: Element, init: WheelEventInit = { deltaY: 100 }) {
  const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

describe("protectFieldsFromWheel", () => {
  let stop: () => void;
  let scroller: HTMLDivElement;

  function field(html: string) {
    scroller.innerHTML = html;
    return scroller.firstElementChild as HTMLElement;
  }

  beforeEach(() => {
    stop = protectFieldsFromWheel();
    scroller = document.createElement("div");
    scroller.style.overflowY = "auto";
    document.body.append(scroller);
  });

  afterEach(() => {
    stop();
    scroller.remove();
  });

  it.each([
    '<input type="number" value="5" />',
    '<input type="date" />',
    '<input type="time" />',
    '<input type="datetime-local" />',
    "<select><option>A</option><option>B</option></select>",
  ])("scrolls the page instead of stepping a focused %s", (html) => {
    const input = field(html);
    input.focus();

    expect(wheel(input).defaultPrevented).toBe(true);
    expect(scroller.scrollTop).toBe(100);
    expect(document.activeElement).toBe(input);
  });

  it("converts a wheel counted in lines to pixels", () => {
    const input = field('<input type="number" />');
    input.focus();

    wheel(input, { deltaY: 3, deltaMode: WheelEvent.DOM_DELTA_LINE });

    expect(scroller.scrollTop).toBe(48);
  });

  it("leaves the field alone once focus has moved off it", () => {
    const input = field('<input type="number" />');
    input.focus();
    input.blur();

    expect(wheel(input).defaultPrevented).toBe(false);
    expect(scroller.scrollTop).toBe(0);
  });

  it("leaves text fields and multi-row lists to the browser", () => {
    for (const html of [
      '<input type="text" />',
      "<textarea></textarea>",
      '<select size="4"></select>',
    ]) {
      const input = field(html);
      input.focus();

      expect(wheel(input).defaultPrevented).toBe(false);
    }
  });

  it("leaves Ctrl + wheel to the browser's zoom", () => {
    const input = field('<input type="number" />');
    input.focus();

    expect(wheel(input, { deltaY: 100, ctrlKey: true }).defaultPrevented).toBe(false);
    expect(scroller.scrollTop).toBe(0);
  });

  it("does not scroll the page behind a dialog", () => {
    const dialog = field('<div style="position: fixed"><input type="number" /></div>');
    const input = dialog.querySelector("input")!;
    input.focus();

    expect(wheel(input).defaultPrevented).toBe(true);
    expect(scroller.scrollTop).toBe(0);
  });
});
