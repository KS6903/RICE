import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import TenantBackupLoad from "./TenantBackupLoad";
import { adminService, type TenantBackupStatus } from "../../services/AdminService";

const SUMMARY = {
  company: "Old Mill",
  created_at: "2026-10-20T08:00:00+00:00",
  created_by: "oldowner",
  rows: 1234,
  tables: 40,
  branches: 2,
};

function draw(status: TenantBackupStatus) {
  vi.spyOn(adminService, "getTenantBackupStatus").mockResolvedValue(status);
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <TenantBackupLoad tenantId="t1" tenantName="New Mill" />
    </QueryClientProvider>,
  );
}

const choose = (file: File) =>
  fireEvent.change(document.getElementById("tenant-backup-file") as HTMLInputElement, {
    target: { files: [file] },
  });

describe("TenantBackupLoad", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("checks the file with the Boss's email, then loads it on the second step", async () => {
    const inspect = vi.spyOn(adminService, "inspectTenantBackup").mockResolvedValue(SUMMARY);
    const restore = vi.spyOn(adminService, "restoreTenantBackup").mockResolvedValue(SUMMARY);
    draw({ empty: true, has_boss: true, owner_email: "boss@mill.ph" });
    expect(await screen.findByDisplayValue("boss@mill.ph")).toBeTruthy();

    const file = new File(["sealed"], "old-mill.oraiza");
    choose(file);
    await waitFor(() => expect(inspect).toHaveBeenCalledWith("t1", file, "boss@mill.ph"));
    expect(await screen.findByText(/1,234 records in 2 branches/)).toBeTruthy();
    expect(restore).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Load into New Mill" }));
    await waitFor(() => expect(restore).toHaveBeenCalledWith("t1", file, "boss@mill.ph"));
    expect(await screen.findByText(/Loaded 1,234 records from Old Mill/)).toBeTruthy();
  });

  it("opens the file with another email when one is typed", async () => {
    const inspect = vi.spyOn(adminService, "inspectTenantBackup").mockResolvedValue(SUMMARY);
    draw({ empty: true, has_boss: true, owner_email: null });
    const field = await screen.findByLabelText("The backup's email");
    fireEvent.change(field, { target: { value: "old.owner@mill.ph" } });

    const file = new File(["sealed"], "old-mill.oraiza");
    choose(file);
    await waitFor(() => expect(inspect).toHaveBeenCalledWith("t1", file, "old.owner@mill.ph"));
  });

  it("offers no upload while the tenant has records", async () => {
    draw({ empty: false, has_boss: true, owner_email: "boss@mill.ph" });
    expect(await screen.findByText(/already has records of its own/)).toBeTruthy();
    expect(document.getElementById("tenant-backup-file")).toBeNull();
  });
});
