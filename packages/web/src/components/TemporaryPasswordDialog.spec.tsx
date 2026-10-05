import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import TemporaryPasswordDialog from "./TemporaryPasswordDialog";

const given = {
  username: "maria",
  temporary_password: "Temp-Pass-0000",
  expires_at: "2026-10-05T06:00:00Z",
};

const draw = (issue = vi.fn().mockResolvedValue(given), onClose = vi.fn()) => {
  render(<TemporaryPasswordDialog name="Maria Cruz" issue={issue} onClose={onClose} />);
  return { issue, onClose };
};

describe("TemporaryPasswordDialog", () => {
  it("says what it does and issues nothing until asked", () => {
    const { issue } = draw();
    expect(
      screen.getByRole("dialog", { name: "Give Maria Cruz a temporary password?" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/replaces their password, unlocks their account/)).toBeInTheDocument();
    expect(screen.getByText(/choose their own password the first time/)).toBeInTheDocument();
    expect(issue).not.toHaveBeenCalled();
  });

  it("shows the password once it is issued, with when it stops working", async () => {
    const { issue } = draw();
    fireEvent.click(screen.getByRole("button", { name: "Give temporary password" }));
    expect(await screen.findByLabelText("Temporary password")).toHaveTextContent("Temp-Pass-0000");
    expect(issue).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/the only time you will see it/i)).toBeInTheDocument();
    expect(screen.getByText(/stops working on/)).toBeInTheDocument();
    expect(
      screen.getByRole("dialog", { name: "Temporary password for Maria Cruz" }),
    ).toBeInTheDocument();
  });

  it("copies the password", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    draw();
    fireEvent.click(screen.getByRole("button", { name: "Give temporary password" }));
    fireEvent.click(await screen.findByRole("button", { name: "Copy the temporary password" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("Temp-Pass-0000"));
  });

  it("says what went wrong, and lets the Boss try again", async () => {
    const issue = vi
      .fn()
      .mockRejectedValueOnce({ response: { data: { detail: "Only the Boss can do that." } } })
      .mockResolvedValueOnce(given);
    draw(issue);
    fireEvent.click(screen.getByRole("button", { name: "Give temporary password" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Only the Boss can do that.");
    expect(screen.queryByLabelText("Temporary password")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Give temporary password" }));
    expect(await screen.findByLabelText("Temporary password")).toBeInTheDocument();
  });

  it("closes from Cancel, Done and Escape", async () => {
    const first = draw();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(first.onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(first.onClose).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole("button", { name: "Give temporary password" }));
    fireEvent.click(await screen.findByRole("button", { name: "Done" }));
    expect(first.onClose).toHaveBeenCalledTimes(3);
  });
});
