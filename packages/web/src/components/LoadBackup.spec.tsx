import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { AxiosError, AxiosHeaders } from "axios";
import LoadBackup from "./LoadBackup";
import { useAuthStore } from "../stores/authStore";
import { dataExportService, type BackupSummary } from "../services/DataExportService";

const summary: BackupSummary = {
  company: "Rice Mill 1",
  created_at: "2026-10-12T08:00:00+00:00",
  created_by: "mill1",
  rows: 12345,
  tables: 52,
  branches: 2,
};

const refusal = (status: number, detail: string, code?: string) =>
  new AxiosError("refused", String(status), undefined, undefined, {
    status,
    statusText: "",
    headers: {},
    config: { headers: new AxiosHeaders() },
    data: { detail, code },
  });

function draw() {
  const view = render(
    <MemoryRouter>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <LoadBackup />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  const file = new File([new Uint8Array([0x89, 0x4f])], "rice-mill-1-backup-2026-10-12.oraiza");
  const choose = () =>
    fireEvent.change(view.container.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [file] },
    });
  return { file, choose };
}

describe("LoadBackup", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    useAuthStore.setState({ user: null });
  });

  it("only takes .oraiza files", () => {
    draw();
    expect((document.querySelector('input[type="file"]') as HTMLInputElement).accept).toBe(
      ".oraiza",
    );
  });

  it("checks a chosen file, then loads it once the owner confirms", async () => {
    const inspect = vi.spyOn(dataExportService, "inspectBackup").mockResolvedValue(summary);
    const load = vi.spyOn(dataExportService, "restoreBackup").mockResolvedValue(summary);
    const { file, choose } = draw();

    choose();
    expect(
      await screen.findByText(/made Oct 12, 2026 by mill1: 12,345 records in 2 branches/),
    ).toBeTruthy();
    expect(inspect).toHaveBeenCalledWith(file);
    expect(load).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Load this backup/ }));
    const dialog = await screen.findByRole("dialog", { name: "Confirm it is you" });
    expect(dialog.textContent).toContain("Loading puts the backup's records into this account.");
    fireEvent.change(screen.getByLabelText("Your password"), { target: { value: "new-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() =>
      expect(load).toHaveBeenCalledWith(file, { password: "new-secret", code: "" }),
    );
    expect(await screen.findByText(/Loaded 12,345 records from Rice Mill 1's backup/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Add your staff" }).getAttribute("href")).toBe(
      "/users",
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("asks for the authenticator code too, with two-factor on", async () => {
    useAuthStore.setState({
      user: {
        id: "u1",
        username: "new",
        role: "owner",
        company_id: "c1",
        mfa_enabled: true,
      } as never,
    });
    vi.spyOn(dataExportService, "inspectBackup").mockResolvedValue(summary);
    const { choose } = draw();
    choose();
    fireEvent.click(await screen.findByRole("button", { name: /Load this backup/ }));
    expect(await screen.findByLabelText("Authenticator code")).toBeTruthy();
  });

  it("says why a file was refused, and offers no load", async () => {
    vi.spyOn(dataExportService, "inspectBackup").mockRejectedValue(
      refusal(400, "Your plan allows 1 branch, and this backup has 3.", "backup_branch_limit"),
    );
    const load = vi.spyOn(dataExportService, "restoreBackup");
    const { choose } = draw();

    choose();
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Your plan allows 1 branch, and this backup has 3.",
    );
    expect(screen.queryByRole("button", { name: /Load this backup/ })).toBeNull();
    expect(load).not.toHaveBeenCalled();
  });

  it("asks again when the password is turned down", async () => {
    vi.spyOn(dataExportService, "inspectBackup").mockResolvedValue(summary);
    vi.spyOn(dataExportService, "restoreBackup").mockRejectedValue(
      refusal(400, "Your password is incorrect.", "confirm_failed"),
    );
    const { choose } = draw();
    choose();
    fireEvent.click(await screen.findByRole("button", { name: /Load this backup/ }));
    fireEvent.change(await screen.findByLabelText("Your password"), { target: { value: "nope" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    const dialog = await screen.findByRole("dialog", { name: "Confirm it is you" });
    expect(dialog.textContent).toContain("Your password is incorrect.");
    expect((screen.getByLabelText("Your password") as HTMLInputElement).value).toBe("");
  });

  it("shows why a load was refused, such as the old account's password", async () => {
    vi.spyOn(dataExportService, "inspectBackup").mockResolvedValue(summary);
    vi.spyOn(dataExportService, "restoreBackup").mockRejectedValue(
      refusal(400, "For your security, choose a new password.", "backup_same_login"),
    );
    const { choose } = draw();
    choose();
    fireEvent.click(await screen.findByRole("button", { name: /Load this backup/ }));
    fireEvent.change(await screen.findByLabelText("Your password"), { target: { value: "old" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "For your security, choose a new password.",
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
