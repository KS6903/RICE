import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import Select from "./Select";

const ROLES = [
  { value: "1", label: "Boss" },
  { value: "3", label: "Mill Operator" },
  { value: "4", label: "Accountant" },
  { value: "5", label: "Cashier" },
];

function Harness({
  onChange = () => {},
  disabled = false,
}: {
  onChange?: (value: string) => void;
  disabled?: boolean;
}) {
  const [value, setValue] = useState("3");
  return (
    <>
      <label htmlFor="role">Role</label>
      <Select
        id="role"
        value={value}
        disabled={disabled}
        options={ROLES}
        onChange={(v) => {
          setValue(v);
          onChange(v);
        }}
      />
    </>
  );
}

const trigger = () => screen.getByRole("button", { name: /role/i });

describe("Select", () => {
  it("shows the chosen option, closed, like any other field", () => {
    render(<Harness />);
    expect(trigger()).toHaveTextContent("Mill Operator");
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("opens its own menu in <body>, marks the choice, and picks on click", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(trigger());

    const list = screen.getByRole("listbox");
    expect(list.parentElement).toBe(document.body);
    expect(screen.getByRole("option", { name: "Mill Operator" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    fireEvent.click(screen.getByRole("option", { name: "Cashier" }));
    expect(onChange).toHaveBeenCalledWith("5");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(trigger()).toHaveTextContent("Cashier");
  });

  it("works from the keyboard", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.keyDown(trigger(), { key: "ArrowDown" });
    const list = screen.getByRole("listbox");
    expect(list).toHaveFocus();

    fireEvent.keyDown(list, { key: "ArrowDown" }); // Mill Operator -> Accountant
    fireEvent.keyDown(list, { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith("4");
    expect(trigger()).toHaveFocus();

    // A letter jumps to the next option that starts with it.
    fireEvent.keyDown(trigger(), { key: "Enter" });
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "b" });
    fireEvent.keyDown(screen.getByRole("listbox"), { key: " " });
    expect(onChange).toHaveBeenLastCalledWith("1");
  });

  it("closes on Escape without changing anything", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(trigger());
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("doesn't open when disabled", () => {
    render(<Harness disabled />);
    fireEvent.click(trigger());
    fireEvent.keyDown(trigger(), { key: "ArrowDown" });
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
