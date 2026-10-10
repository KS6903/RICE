import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import TruncatedText from "./TruncatedText";

const NAME = "Maria Cristina Dela Cruz-Villanueva y Fernandez";

describe("TruncatedText", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("cuts the text short in its cell and carries the whole of it as the hover title", () => {
    render(<TruncatedText text={NAME} className="max-w-[10rem]" />);
    const el = screen.getByText(NAME);
    expect(el.className).toContain("truncate");
    expect(el.getAttribute("title")).toBe(NAME);
  });

  it("opens the whole text on a press and hold, and closes it after a few seconds", () => {
    render(<TruncatedText text={NAME} />);
    expect(screen.queryByRole("tooltip")).toBeNull();

    fireEvent.touchStart(screen.getByText(NAME));
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.getByRole("tooltip").textContent).toBe(NAME);

    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("does nothing for a quick tap", () => {
    render(<TruncatedText text={NAME} />);
    const el = screen.getByText(NAME);
    fireEvent.touchStart(el);
    act(() => {
      vi.advanceTimersByTime(150);
    });
    fireEvent.touchEnd(el);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("closes when the user touches somewhere else", () => {
    render(
      <div>
        <TruncatedText text={NAME} />
        <p>elsewhere</p>
      </div>,
    );
    fireEvent.touchStart(screen.getByText(NAME));
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.getByRole("tooltip")).toBeTruthy();

    fireEvent.touchStart(screen.getByText("elsewhere"));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});
