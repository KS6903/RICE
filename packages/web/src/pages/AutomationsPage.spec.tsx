import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  section: "reports",
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

const bigSale: Automation = {
  ...digest,
  code: "big_transaction",
  title: "Big transaction",
  description: "A sale over your limit.",
  group: "watch",
  fields: [
    { name: "sale_over", label: "Sales over", kind: "money", help: "" },
    { name: "older_than", label: "Older than", kind: "number", help: "", unit: "hours" },
    {
      name: "mode",
      label: "When over the limit",
      kind: "select",
      help: "",
      options: [
        { value: "warn", label: "Warn me" },
        { value: "block", label: "Stop the order" },
      ],
    },
  ],
  params: { sale_over: 100000, older_than: 24, mode: "warn" },
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

const card = (title: string) => screen.getByRole("article", { name: title });

describe("AutomationsPage", () => {
  beforeEach(() => {
    vi.spyOn(automationsService, "list").mockResolvedValue({ recipes: [digest, bigSale] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useAuthStore.setState({ user: null });
  });

  it("groups the recipes under headings and counts what's on", async () => {
    useAuthStore.setState({ user: owner });
    draw();
    const reports = await screen.findByRole("region", { name: "Reports and summaries" });
    expect(within(reports).getByRole("heading", { name: "Morning summary" })).toBeInTheDocument();
    const watch = screen.getByRole("region", { name: "Owner watch" });
    expect(within(watch).getByRole("heading", { name: "Big transaction" })).toBeInTheDocument();
    expect(screen.getByText(/0 of 2 switched on/)).toBeInTheDocument();
    // Groups with nothing in them aren't shown.
    expect(screen.queryByRole("region", { name: "Deliveries" })).toBeNull();
  });

  it("keeps settings folded away until asked for", async () => {
    useAuthStore.setState({ user: owner });
    draw();
    await screen.findByRole("heading", { name: "Morning summary" });
    expect(screen.queryByLabelText("Send at")).toBeNull();
    fireEvent.click(within(card("Morning summary")).getByRole("button", { name: "Settings" }));
    expect(screen.getByLabelText("Send at")).toHaveValue("06:00");
    expect(screen.getByText(/goes to the owner: Mill Owner/)).toBeInTheDocument();
  });

  it("saves straight away when the switch is flipped", async () => {
    useAuthStore.setState({ user: owner });
    const update = vi
      .spyOn(automationsService, "update")
      .mockResolvedValue({ ...digest, enabled: true });
    draw();
    await screen.findByRole("heading", { name: "Morning summary" });
    fireEvent.click(within(card("Morning summary")).getByRole("switch"));
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith("owner_digest", {
        enabled: true,
        params: { send_at: "06:00", email: true },
        recipients: [],
      }),
    );
  });

  it("shows money, units and choices, and saves edited settings", async () => {
    useAuthStore.setState({ user: owner });
    const update = vi.spyOn(automationsService, "update").mockResolvedValue(bigSale);
    draw();
    await screen.findByRole("heading", { name: "Big transaction" });
    const big = card("Big transaction");
    fireEvent.click(within(big).getByRole("button", { name: "Settings" }));
    const save = within(big).getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();

    expect(within(big).getByText("₱")).toBeInTheDocument();
    expect(within(big).getByText("hours")).toBeInTheDocument();
    fireEvent.change(within(big).getByLabelText("Sales over"), { target: { value: "150,000" } });
    fireEvent.change(within(big).getByLabelText("When over the limit"), {
      target: { value: "block" },
    });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith("big_transaction", {
        enabled: false,
        params: { sale_over: "150000", older_than: 24, mode: "block" },
        recipients: [],
      }),
    );
  });

  it("is read-only for an accountant", async () => {
    useAuthStore.setState({ user: { ...owner, id: "u2", role: "accountant" } });
    draw();
    expect(screen.getByText(/only an owner or admin can change them/)).toBeInTheDocument();
    await screen.findByRole("heading", { name: "Morning summary" });
    const summary = card("Morning summary");
    expect(within(summary).getByRole("switch")).toBeDisabled();
    fireEvent.click(within(summary).getByRole("button", { name: "Settings" }));
    expect(screen.getByLabelText("Send at")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByRole("button", { name: /send me a test/i })).toBeNull();
  });
});
