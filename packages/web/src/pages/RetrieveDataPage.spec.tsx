import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import RetrieveDataPage from "./RetrieveDataPage";
import { useAuthStore } from "../stores/authStore";
import { dataExportService, type BackupStatus } from "../services/DataExportService";

const owner = { id: "u1", username: "newowner", role: "owner", company_id: "c1" };

function signIn(user: object | null) {
  useAuthStore.setState({ user: user as never, accessToken: user ? "token" : null } as never);
}

function draw() {
  return render(
    <MemoryRouter>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <RetrieveDataPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const status = (s: Partial<BackupStatus>) =>
  vi.spyOn(dataExportService, "backupStatus").mockResolvedValue({
    empty: true,
    email: "owner@mill.ph",
    email_verified: true,
    ...s,
  });

describe("RetrieveDataPage", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    signIn(null);
  });

  it("asks a visitor for a new account, and brings them back here after", () => {
    signIn(null);
    const check = vi.spyOn(dataExportService, "backupStatus");
    draw();
    expect(screen.getByText(/new username and password/, { selector: "li span" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Create a new account" }).getAttribute("href")).toBe(
      "/signup?next=%2Fretrieve-data",
    );
    expect(screen.getByRole("link", { name: /sign in/ }).getAttribute("href")).toBe(
      "/login?next=%2Fretrieve-data",
    );
    expect(check).not.toHaveBeenCalled();
  });

  it("takes the backup in a new, empty account with a confirmed email", async () => {
    signIn(owner);
    status({});
    draw();
    expect(await screen.findByText("Upload your data")).toBeTruthy();
  });

  it("turns away an account that already has records", async () => {
    signIn(owner);
    status({ empty: false });
    draw();
    expect(await screen.findByText(/already has records of its own/)).toBeTruthy();
    expect(screen.queryByText("Upload your data")).toBeNull();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
  });

  it("asks for a confirmed email first", async () => {
    signIn(owner);
    status({ email_verified: false });
    draw();
    expect(await screen.findByText(/Confirm your email address first/)).toBeTruthy();
    expect(screen.queryByText("Upload your data")).toBeNull();
  });

  it("is for the Boss only", () => {
    signIn({ ...owner, role: "cashier" });
    const check = vi.spyOn(dataExportService, "backupStatus");
    draw();
    expect(screen.getByText(/Only the account's Boss can load a backup/)).toBeTruthy();
    expect(check).not.toHaveBeenCalled();
  });
});
