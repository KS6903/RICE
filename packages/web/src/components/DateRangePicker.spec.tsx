import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import DateRangePicker from "./DateRangePicker";

const draw = (onChange = vi.fn()) => {
  render(
    <DateRangePicker aria-label="Period" start="2026-10-01" end="2026-10-31" onChange={onChange} />,
  );
  return onChange;
};

const day = (iso: string) => document.querySelector(`[data-day="${iso}"]`) as HTMLElement;

describe("DateRangePicker", () => {
  it("shows the period in one field", () => {
    draw();
    expect(screen.getByRole("button", { name: "Period" })).toHaveTextContent(
      "Oct 1 to Oct 31, 2026",
    );
  });

  it("takes both ends from one calendar, and tells the page only when it has both", () => {
    const onChange = draw();
    fireEvent.click(screen.getByRole("button", { name: "Period" }));

    fireEvent.click(day("2026-10-05"));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toHaveTextContent("Now tap the last day.");

    fireEvent.click(day("2026-10-20"));
    expect(onChange).toHaveBeenCalledWith("2026-10-05", "2026-10-20");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("puts the ends in order, whichever is tapped first", () => {
    const onChange = draw();
    fireEvent.click(screen.getByRole("button", { name: "Period" }));
    fireEvent.click(day("2026-10-20"));
    fireEvent.click(day("2026-10-05"));
    expect(onChange).toHaveBeenCalledWith("2026-10-05", "2026-10-20");
  });

  it("takes one day when the same day is tapped twice", () => {
    const onChange = draw();
    fireEvent.click(screen.getByRole("button", { name: "Period" }));
    fireEvent.click(day("2026-10-12"));
    fireEvent.click(day("2026-10-12"));
    expect(onChange).toHaveBeenCalledWith("2026-10-12", "2026-10-12");
  });

  it("marks the days of the period", () => {
    draw();
    fireEvent.click(screen.getByRole("button", { name: "Period" }));
    expect(day("2026-10-15")).toHaveAttribute("aria-pressed", "true");
    expect(day("2026-11-01")).toHaveAttribute("aria-pressed", "false");
  });

  it("moves to another month without losing the first day", () => {
    const onChange = draw();
    fireEvent.click(screen.getByRole("button", { name: "Period" }));
    fireEvent.click(day("2026-10-20"));
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    fireEvent.click(day("2026-11-10"));
    expect(onChange).toHaveBeenCalledWith("2026-10-20", "2026-11-10");
  });
});
