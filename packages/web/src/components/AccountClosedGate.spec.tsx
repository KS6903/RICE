import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { User } from "@rice-mill/shared";
import AccountClosedGate from "./AccountClosedGate";
import { authService } from "../services/AuthService";
import { dataExportService } from "../services/DataExportService";
import { useAuthStore } from "../stores/authStore";

const boss = (account: User["account"]): User => ({
  id: "u1",
  username: "mill1",
  full_name: "Mill Boss",
  role: "owner",
  company_id: "c1",
  features: [],
  account,
});

const draw = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <AccountClosedGate />
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe("AccountClosedGate", () => {
  beforeEach(() => {
    vi.spyOn(dataExportService, "backupStatus").mockResolvedValue({
      empty: false,
      email: "boss@mill.test",
      email_verified: true,
    } as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useAuthStore.setState({ user: null });
  });

  it("switches a paused account back on", async () => {
    useAuthStore.setState({
      user: boss({
        state: "paused",
        closed_at: "2026-10-24T09:00:00+08:00",
        deletion_requested_at: null,
        export_until: null,
      }),
    });
    const reopen = vi.spyOn(authService, "reopenAccount").mockResolvedValue({
      state: "open",
      closed_at: null,
      deletion_requested_at: null,
      export_until: null,
    });
    const reopened = boss({
      state: "open",
      closed_at: null,
      deletion_requested_at: null,
      export_until: null,
    });
    vi.spyOn(authService, "me").mockResolvedValue(reopened);
    draw();

    expect(screen.getByText("This account is paused")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Switch it back on/ }));
    await waitFor(() => expect(reopen).toHaveBeenCalled());
    await waitFor(() => expect(useAuthStore.getState().user?.account?.state).toBe("open"));
  });

  it("offers the data and the way back while a deletion waits", () => {
    useAuthStore.setState({
      user: boss({
        state: "deletion_requested",
        closed_at: "2026-10-24T09:00:00+08:00",
        deletion_requested_at: "2026-10-24T09:00:00+08:00",
        export_until: "2026-11-23T09:00:00+08:00",
      }),
    });
    draw();
    expect(screen.getByText("This account is set to be deleted")).toBeInTheDocument();
    expect(screen.getByText(/download the mill's data, or take the/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Keep my account/ })).toBeInTheDocument();
  });
});
