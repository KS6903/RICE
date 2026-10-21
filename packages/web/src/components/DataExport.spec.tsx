import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import DataExport from "./DataExport";
import { dataExportService } from "../services/DataExportService";

function draw() {
  return render(
    <MemoryRouter>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <DataExport />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("DataExport backup and restore", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("offers the upload only while the account is empty", async () => {
    vi.spyOn(dataExportService, "backupStatus").mockResolvedValue({
      empty: true,
      email: "owner@mill.ph",
      email_verified: true,
    });
    draw();
    expect(await screen.findByText("Upload your data")).toBeTruthy();
    expect(screen.getByText("owner@mill.ph")).toBeTruthy();
  });

  it("points an account with records to /retrieve-data instead", async () => {
    vi.spyOn(dataExportService, "backupStatus").mockResolvedValue({
      empty: false,
      email: "owner@mill.ph",
      email_verified: true,
    });
    draw();
    const link = await screen.findByRole("link", { name: "How to retrieve your data" });
    expect(link.getAttribute("href")).toBe("/retrieve-data");
    expect(screen.queryByText("Upload your data")).toBeNull();
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it("asks for an email address before a backup can be made", async () => {
    vi.spyOn(dataExportService, "backupStatus").mockResolvedValue({
      empty: false,
      email: null,
      email_verified: false,
    });
    draw();
    expect(await screen.findByText(/Add an email address under My Profile first/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Download a backup/ }).hasAttribute("disabled")).toBe(
      true,
    );
  });

  it("downloads a backup under the server's file name", async () => {
    vi.spyOn(dataExportService, "backupStatus").mockResolvedValue({
      empty: false,
      email: "owner@mill.ph",
      email_verified: true,
    });
    const blob = new Blob(["sealed"]);
    vi.spyOn(dataExportService, "downloadBackup").mockResolvedValue({
      blob,
      filename: "rice-mill-1-backup-2026-10-20.oraiza",
    });
    const created = vi.fn(() => "blob:x");
    URL.createObjectURL = created;
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    draw();

    fireEvent.click(screen.getByRole("button", { name: /Download a backup/ }));
    expect(await screen.findByText("Downloaded rice-mill-1-backup-2026-10-20.oraiza")).toBeTruthy();
    expect(created).toHaveBeenCalledWith(blob);
  });
});
