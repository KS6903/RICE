import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { User } from "@rice-mill/shared";
import AutomationsPage from "./AutomationsPage";
import { useAuthStore } from "../stores/authStore";
import { automationsService, type Automation } from "../services/AutomationsService";

const digest: Automation = {
  code: "owner_digest",
  title: "Morning summary",
  description: "Every morning, yesterday at a glance.",
  group: "reports",
  fields: [
    { name: "send_at", label: "Send at", kind: "time", help: "Before noon." },
    { name: "email", label: "Also email it", kind: "bool", help: "" },
  ],
  params: { send_at: "06:00", email: true },
  enabled: false,
  recipients: [],
  effective_recipients: ["u1"],
  default_roles: ["owner"],
  candidates: [
    { id: "u1", name: "Mill Owner", role: "owner" },
    { id: "u2", name: "Ana Books", role: "accountant" },
  ],
  last_run: null,
};

const owner: User = {
  id: "u1",
  username: "mill1",
  full_name: "Mill Owner",
  role: "owner",
  company_id: "c1",
};

const draw = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <AutomationsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe("AutomationsPage", () => {
  beforeEach(() => {
    vi.spyOn(automationsService, "list").mockResolvedValue({ recipes: [digest] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useAuthStore.setState({ user: null });
  });

  it("shows the morning summary with its settings", async () => {
    useAuthStore.setState({ user: owner });
    draw();
    expect(await screen.findByRole("heading", { name: "Morning summary" })).toBeInTheDocument();
    expect(screen.getByLabelText("Send at")).toHaveValue("06:00");
    expect(screen.getByText(/goes to the owner: Mill Owner/)).toBeInTheDocument();
  });

  it("lets an owner switch it on and save", async () => {
    useAuthStore.setState({ user: owner });
    const update = vi
      .spyOn(automationsService, "update")
      .mockResolvedValue({ ...digest, enabled: true });
    draw();
    const save = await screen.findByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    fireEvent.click(screen.getByRole("switch"));
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith("owner_digest", {
        enabled: true,
        params: { send_at: "06:00", email: true },
        recipients: [],
      }),
    );
  });

  it("is read-only for an accountant", async () => {
    useAuthStore.setState({ user: { ...owner, id: "u2", role: "accountant" } });
    draw();
    expect(screen.getByText(/only an owner or admin can change them/)).toBeInTheDocument();
    // The note is in the header; wait for the card itself before checking it.
    expect(await screen.findByRole("switch")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByRole("button", { name: /send me a test/i })).toBeNull();
  });
});
