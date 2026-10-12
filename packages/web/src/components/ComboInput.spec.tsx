import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import ComboInput from "./ComboInput";

const POSITIONS = ["Mill Operator", "Assistant Operator", "Driver", "Cashier"];

function Harness({ onChange = () => {} }: { onChange?: (value: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <form onSubmit={(e) => e.preventDefault()}>
      <ComboInput
        aria-label="Position"
        value={value}
        suggestions={POSITIONS}
        onChange={(v) => {
          setValue(v);
          onChange(v);
        }}
      />
    </form>
  );
}

const field = () => screen.getByRole("combobox", { name: "Position" });

describe("ComboInput", () => {
  it("offers every suggestion on focus, in its own menu in <body>", () => {
    render(<Harness />);
    fireEvent.focus(field());
    const list = screen.getByRole("listbox");
    expect(list.parentElement).toBe(document.body);
    expect(screen.getAllByRole("option")).toHaveLength(4);
  });

  it("narrows as the person types and still accepts anything else", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.change(field(), { target: { value: "oper" } });
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Mill Operator",
      "Assistant Operator",
    ]);

    fireEvent.change(field(), { target: { value: "Night watch" } });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onChange).toHaveBeenLastCalledWith("Night watch");
  });

  it("takes a suggestion on click", () => {
    render(<Harness />);
    fireEvent.focus(field());
    fireEvent.click(screen.getByRole("option", { name: "Driver" }));
    expect(field()).toHaveValue("Driver");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("works from the keyboard without submitting the form", () => {
    const submit = vi.fn();
    render(
      <form onSubmit={submit}>
        <ComboInput aria-label="Position" value="" suggestions={POSITIONS} onChange={() => {}} />
      </form>,
    );
    fireEvent.keyDown(field(), { key: "ArrowDown" });
    fireEvent.keyDown(field(), { key: "ArrowDown" });
    expect(field()).toHaveAttribute("aria-activedescendant", expect.stringMatching(/-1$/));
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(submit).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("closes on Escape and keeps the Escape to itself", () => {
    const outer = vi.fn();
    render(
      <div onKeyDown={outer}>
        <Harness />
      </div>,
    );
    fireEvent.focus(field());
    fireEvent.keyDown(field(), { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(outer).not.toHaveBeenCalled();
  });
});
