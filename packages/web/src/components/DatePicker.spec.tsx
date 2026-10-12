import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import DatePicker from "./DatePicker";
import DateTimePicker from "./DateTimePicker";
import TimePicker from "./TimePicker";

function Harness({
  initial = "",
  onChange = () => {},
  ...rest
}: {
  initial?: string;
  onChange?: (value: string) => void;
  min?: string;
  max?: string;
  clearable?: boolean;
  disabled?: boolean;
}) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <label htmlFor="when">Pay by</label>
      <DatePicker
        id="when"
        value={value}
        onChange={(v) => {
          setValue(v);
          onChange(v);
        }}
        {...rest}
      />
    </>
  );
}

const trigger = () => screen.getByRole("button", { name: "Pay by" });
const panel = () => within(screen.getByRole("dialog", { name: "Choose a date" }));

describe("DatePicker", () => {
  it("shows the chosen day, closed, like any other field", () => {
    render(<Harness initial="2026-10-02" />);
    expect(trigger()).toHaveTextContent("Oct 2, 2026");
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens its own calendar in <body> on the chosen month and picks on click", () => {
    const onChange = vi.fn();
    render(<Harness initial="2026-10-02" onChange={onChange} />);
    fireEvent.click(trigger());

    const dialog = screen.getByRole("dialog", { name: "Choose a date" });
    expect(dialog.parentElement).toBe(document.body);
    expect(panel().getByRole("group", { name: "October 2026" })).toBeInTheDocument();
    expect(panel().getByRole("button", { name: "Friday, October 2, 2026" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.click(panel().getByRole("button", { name: "Tuesday, October 20, 2026" }));
    expect(onChange).toHaveBeenCalledWith("2026-10-20");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger()).toHaveTextContent("Oct 20, 2026");
    expect(trigger()).toHaveFocus();
  });

  it("steps by month with Previous and Next", () => {
    render(<Harness initial="2026-10-02" />);
    fireEvent.click(trigger());
    fireEvent.click(panel().getByRole("button", { name: "Previous month" }));
    expect(panel().getByRole("group", { name: "September 2026" })).toBeInTheDocument();
    fireEvent.click(panel().getByRole("button", { name: "Next month" }));
    fireEvent.click(panel().getByRole("button", { name: "Next month" }));
    expect(panel().getByRole("group", { name: "November 2026" })).toBeInTheDocument();
  });

  it("jumps to a far-off month through the month and year choosers", () => {
    const onChange = vi.fn();
    render(<Harness initial="2026-10-02" onChange={onChange} />);
    fireEvent.click(trigger());

    fireEvent.click(panel().getByRole("button", { name: "Choose month and year" }));
    fireEvent.click(panel().getByRole("button", { name: "Choose year" }));
    // Years come twelve to a page (2016 to 2027 holds 2026); three pages back
    // is 1980 to 1991.
    for (let page = 0; page < 3; page++) {
      fireEvent.click(panel().getByRole("button", { name: "Previous years" }));
    }
    fireEvent.click(panel().getByRole("button", { name: "1985" }));
    fireEvent.click(panel().getByRole("button", { name: "Mar" }));
    expect(panel().getByRole("group", { name: "March 1985" })).toBeInTheDocument();
    fireEvent.click(panel().getByRole("button", { name: "Friday, March 15, 1985" }));
    expect(onChange).toHaveBeenCalledWith("1985-03-15");
  });

  it("disables days outside min and max", () => {
    const onChange = vi.fn();
    render(<Harness initial="2026-10-02" min="2026-10-05" max="2026-10-20" onChange={onChange} />);
    fireEvent.click(trigger());
    const early = panel().getByRole("button", { name: "Sunday, October 4, 2026" });
    const late = panel().getByRole("button", { name: "Thursday, October 22, 2026" });
    expect(early).toBeDisabled();
    expect(late).toBeDisabled();
    fireEvent.click(early);
    expect(onChange).not.toHaveBeenCalled();
    expect(panel().getByRole("button", { name: "Monday, October 5, 2026" })).toBeEnabled();
  });

  it("works from the keyboard", () => {
    const onChange = vi.fn();
    render(<Harness initial="2026-10-02" onChange={onChange} />);
    fireEvent.keyDown(trigger(), { key: "ArrowDown" });
    const day = panel().getByRole("button", { name: "Friday, October 2, 2026" });
    expect(day).toHaveFocus();

    fireEvent.keyDown(day, { key: "ArrowRight" }); // Oct 3
    fireEvent.keyDown(screen.getByRole("button", { name: "Saturday, October 3, 2026" }), {
      key: "ArrowDown",
    }); // Oct 10
    fireEvent.keyDown(screen.getByRole("button", { name: "Saturday, October 10, 2026" }), {
      key: "PageDown",
    }); // Nov 10
    expect(screen.getByRole("button", { name: "Tuesday, November 10, 2026" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Tuesday, November 10, 2026" }));
    expect(onChange).toHaveBeenLastCalledWith("2026-11-10");
  });

  it("closes on Escape without changing anything, and keeps the Escape to itself", () => {
    const onChange = vi.fn();
    const outer = vi.fn();
    render(
      <div onKeyDown={outer}>
        <Harness initial="2026-10-02" onChange={onChange} />
      </div>,
    );
    fireEvent.click(trigger());
    fireEvent.keyDown(panel().getByRole("button", { name: "Friday, October 2, 2026" }), {
      key: "Escape",
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    expect(outer).not.toHaveBeenCalled();
  });

  it("clears an optional date", () => {
    const onChange = vi.fn();
    render(<Harness initial="2026-10-02" clearable onChange={onChange} />);
    fireEvent.click(trigger());
    fireEvent.click(panel().getByRole("button", { name: "Clear" }));
    expect(onChange).toHaveBeenCalledWith("");
    expect(trigger()).toHaveTextContent("Choose a date");
  });

  it("offers no Clear unless the field is clearable", () => {
    render(<Harness initial="2026-10-02" />);
    fireEvent.click(trigger());
    expect(panel().queryByRole("button", { name: "Clear" })).toBeNull();
  });

  it("doesn't open when disabled", () => {
    render(<Harness disabled />);
    fireEvent.click(trigger());
    fireEvent.keyDown(trigger(), { key: "ArrowDown" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("TimePicker", () => {
  function Time({ initial, onChange }: { initial: string; onChange: (v: string) => void }) {
    const [value, setValue] = useState(initial);
    return (
      <TimePicker
        aria-label="Send at"
        value={value}
        onChange={(v) => {
          setValue(v);
          onChange(v);
        }}
      />
    );
  }

  it("shows a 24-hour value as 12-hour time and picks from quarter hours", () => {
    const onChange = vi.fn();
    render(<Time initial="06:00" onChange={onChange} />);
    const field = screen.getByRole("button", { name: "Send at" });
    expect(field).toHaveTextContent("6:00 AM");
    fireEvent.click(field);
    fireEvent.click(screen.getByRole("option", { name: "6:45 PM" }));
    expect(onChange).toHaveBeenCalledWith("18:45");
  });

  it("keeps a time that falls between the steps", () => {
    render(<Time initial="06:07" onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "Send at" })).toHaveTextContent("6:07 AM");
  });
});

describe("DateTimePicker", () => {
  function Both({ initial, onChange }: { initial: string; onChange: (v: string) => void }) {
    const [value, setValue] = useState(initial);
    return (
      <DateTimePicker
        label="Start"
        value={value}
        onChange={(v) => {
          setValue(v);
          onChange(v);
        }}
      />
    );
  }

  it("changes the day and the time independently", () => {
    const onChange = vi.fn();
    render(<Both initial="2026-10-02T14:30" onChange={onChange} />);
    expect(screen.getByRole("button", { name: "Start date" })).toHaveTextContent("Oct 2, 2026");
    expect(screen.getByRole("button", { name: "Start time" })).toHaveTextContent("2:30 PM");

    fireEvent.click(screen.getByRole("button", { name: "Start time" }));
    fireEvent.click(screen.getByRole("option", { name: "9:00 AM" }));
    expect(onChange).toHaveBeenLastCalledWith("2026-10-02T09:00");

    fireEvent.click(screen.getByRole("button", { name: "Start date" }));
    fireEvent.click(screen.getByRole("button", { name: "Monday, October 12, 2026" }));
    expect(onChange).toHaveBeenLastCalledWith("2026-10-12T09:00");
  });
});
