import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { useEscapeKey } from "./useEscapeKey";

function Popup({ onEscape, enabled = true }: { onEscape: () => void; enabled?: boolean }) {
  useEscapeKey(onEscape, enabled);
  return null;
}

const press = (init: KeyboardEventInit = {}) =>
  fireEvent.keyDown(window, { key: "Escape", ...init });

describe("useEscapeKey", () => {
  it("calls the handler when Escape is pressed while the popup is open", () => {
    const close = vi.fn();
    render(<Popup onEscape={close} />);
    press();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("ignores other keys, and Escape while the popup is closed", () => {
    const close = vi.fn();
    const { rerender } = render(<Popup onEscape={close} enabled={false} />);
    press();
    expect(close).not.toHaveBeenCalled();

    rerender(<Popup onEscape={close} enabled />);
    fireEvent.keyDown(window, { key: "Enter" });
    expect(close).not.toHaveBeenCalled();
  });

  it("closes only the popup that opened last, then the one behind it", () => {
    const form = vi.fn();
    const dialog = vi.fn();
    render(<Popup onEscape={form} />);
    const top = render(<Popup onEscape={dialog} />);

    press();
    expect(dialog).toHaveBeenCalledTimes(1);
    expect(form).not.toHaveBeenCalled();

    top.unmount();
    press();
    expect(form).toHaveBeenCalledTimes(1);
  });

  it("leaves an Escape that something else already used", () => {
    const close = vi.fn();
    render(<Popup onEscape={close} />);
    const e = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
    e.preventDefault();
    window.dispatchEvent(e);
    expect(close).not.toHaveBeenCalled();
  });

  it("uses the latest handler without re-registering", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<Popup onEscape={first} />);
    rerender(<Popup onEscape={second} />);
    press();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
