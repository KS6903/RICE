import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { User } from "@rice-mill/shared";
import AccountClosureCard from "./AccountClosureCard";
import { authService, type AccountClosure } from "../services/AuthService";
import { useAuthStore } from "../stores/authStore";

const boss: User = {
  id: "u1",
  username: "mill1",
  full_name: "Mill Boss",
  role: "owner",
  company_id: "c1",
  features: [],
  mfa_enabled: false,
};

const open: AccountClosure = {
  state: "open",
  closed_at: null,
  deletion_requested_at: null,
  export_until: null,
  company_name: "Rice Mill 1",
  export_window_days: 30,
  blockers: [],
};

const draw = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <AccountClosureCard />
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe("AccountClosureCard", () => {
  const logout = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    useAuthStore.setState({ user: boss, logout });
    vi.spyOn(authService, "closeAccount").mockResolvedValue({ ...open, state: "paused" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    logout.mockClear();
    useAuthStore.setState({ user: null });
  });

  it("lists what is still open with Oraiza and keeps both buttons off", async () => {
    vi.spyOn(authService, "accountClosure").mockResolvedValue({
      ...open,
      blockers: [{ code: "paid_time", message: "Your Pro plan is paid until 30 November 2026." }],
    });
    draw();
    expect(await screen.findByText(/paid until 30 November 2026/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Pause account/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Delete account/ })).toBeDisabled();
  });

  it("pauses with the password, then signs out", async () => {
    vi.spyOn(authService, "accountClosure").mockResolvedValue(open);
    draw();
    fireEvent.click(await screen.findByRole("button", { name: /Pause account/ }));
    const dialog = screen.getByRole("alertdialog");
    const confirm = within(dialog).getByRole("button", { name: "Pause it" });
    expect(confirm).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText("Your password"), {
      target: { value: "Password123" },
    });
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(authService.closeAccount).toHaveBeenCalledWith({
        mode: "pause",
        current_password: "Password123",
      }),
    );
    await waitFor(() => expect(logout).toHaveBeenCalled());
  });

  it("asks for the mill's name before a deletion", async () => {
    vi.spyOn(authService, "accountClosure").mockResolvedValue(open);
    draw();
    fireEvent.click(await screen.findByRole("button", { name: /Delete account/ }));
    const dialog = screen.getByRole("alertdialog");
    fireEvent.change(within(dialog).getByLabelText("Your password"), {
      target: { value: "Password123" },
    });
    const confirm = within(dialog).getByRole("button", { name: "Ask to delete it" });
    expect(confirm).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText(/Type the mill's name/), {
      target: { value: "rice mill 1" },
    });
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(authService.closeAccount).toHaveBeenCalledWith({
        mode: "delete",
        current_password: "Password123",
        confirm_name: "rice mill 1",
      }),
    );
  });
});
