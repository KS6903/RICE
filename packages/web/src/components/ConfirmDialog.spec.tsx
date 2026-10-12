import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import ConfirmDialog from "./ConfirmDialog";

function draw(props: Partial<React.ComponentProps<typeof ConfirmDialog>> = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <>
      <button>Remove Ana</button>
      <ConfirmDialog
        open
        danger
        title="Remove Ana?"
        confirmLabel="Remove"
        onConfirm={onConfirm}
        onCancel={onCancel}
        {...props}
      >
        They won't be able to sign in any more.
      </ConfirmDialog>
    </>,
  );
  return { onConfirm, onCancel };
}

describe("ConfirmDialog", () => {
  it("asks in its own dialog, with focus on Cancel so a stray Enter never confirms", () => {
    draw();
    const dialog = screen.getByRole("alertdialog", { name: "Remove Ana?" });
    expect(dialog.parentElement?.parentElement).toBe(document.body);
    expect(dialog).toHaveTextContent("They won't be able to sign in any more.");
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
  });

  it("confirms and cancels", () => {
    const { onConfirm, onCancel } = draw();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("cancels on Escape and on a press on the backdrop, not on a press inside", () => {
    const { onCancel } = draw();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);

    fireEvent.mouseDown(screen.getByRole("alertdialog"));
    expect(onCancel).toHaveBeenCalledTimes(1);
    fireEvent.mouseDown(screen.getByRole("alertdialog").parentElement as Element);
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it("renders nothing while closed", () => {
    draw({ open: false });
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("holds the confirm button while busy", () => {
    draw({ busy: true });
    expect(screen.getByRole("button", { name: "Remove" })).toBeDisabled();
  });
});
