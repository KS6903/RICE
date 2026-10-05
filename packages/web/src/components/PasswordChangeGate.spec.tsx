import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import PasswordChangeGate from "./PasswordChangeGate";
import { authService } from "../services/AuthService";
import { useAuthStore } from "../stores/authStore";

const fill = (current: string, next: string, again: string) => {
  fireEvent.change(screen.getByLabelText("Temporary password"), { target: { value: current } });
  fireEvent.change(screen.getByLabelText("New password"), { target: { value: next } });
  fireEvent.change(screen.getByLabelText("New password again"), { target: { value: again } });
};

describe("PasswordChangeGate", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    useAuthStore.setState({ user: null });
  });

  it("asks for the temporary password and a new one twice, and won't save until they agree", () => {
    render(<PasswordChangeGate />);
    expect(screen.getByRole("heading", { name: "Choose your own password" })).toBeInTheDocument();
    const save = screen.getByRole("button", { name: "Save new password" });
    expect(save).toBeDisabled();

    fill("Xk7m-Rp4q-Tz9w", "My-own-Pass-77", "My-own-Pass-78");
    expect(screen.getByText("The two passwords don't match.")).toBeInTheDocument();
    expect(save).toBeDisabled();

    fill("Xk7m-Rp4q-Tz9w", "short1", "short1");
    expect(save).toBeDisabled(); // under 8 characters

    fill("Xk7m-Rp4q-Tz9w", "My-own-Pass-77", "My-own-Pass-77");
    expect(save).toBeEnabled();
  });

  it("changes the password, then sends them to sign in with the new one", async () => {
    const change = vi.spyOn(authService, "changePassword").mockResolvedValue({});
    const logout = vi.fn().mockResolvedValue(undefined);
    useAuthStore.setState({ logout });
    render(<PasswordChangeGate />);
    fill("Xk7m-Rp4q-Tz9w", "My-own-Pass-77", "My-own-Pass-77");
    fireEvent.click(screen.getByRole("button", { name: "Save new password" }));

    await waitFor(() => expect(change).toHaveBeenCalledWith("Xk7m-Rp4q-Tz9w", "My-own-Pass-77"));
    expect(await screen.findByText("Your password was changed.")).toBeInTheDocument();
    expect(logout).not.toHaveBeenCalled(); // they get to see it worked first
    fireEvent.click(screen.getByRole("button", { name: "Sign in with your new password" }));
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it("says what the server refused", async () => {
    vi.spyOn(authService, "changePassword").mockRejectedValue({
      response: { data: { detail: "Choose a password different from the temporary one." } },
    });
    render(<PasswordChangeGate />);
    fill("Xk7m-Rp4q-Tz9w", "Xk7m-Rp4q-Tz9w", "Xk7m-Rp4q-Tz9w");
    fireEvent.click(screen.getByRole("button", { name: "Save new password" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Choose a password different from the temporary one.",
    );
    expect(screen.queryByText("Your password was changed.")).toBeNull();
  });

  it("lets them sign out instead", () => {
    const logout = vi.fn().mockResolvedValue(undefined);
    useAuthStore.setState({ logout });
    render(<PasswordChangeGate />);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(logout).toHaveBeenCalledTimes(1);
  });
});
