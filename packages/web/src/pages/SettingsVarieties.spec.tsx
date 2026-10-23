import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { User } from "@rice-mill/shared";
import SettingsPage from "./SettingsPage";
import { useAuthStore } from "../stores/authStore";
import { billingService } from "../services/BillingService";
import { paddyService } from "../services/PaddyService";

const owner: User = {
  id: "u1",
  username: "mill1",
  full_name: "Mill Owner",
  role: "owner",
  company_id: "c1",
  features: [],
};

const rc222 = {
  id: "rc222",
  company_id: null,
  code: "Rc222",
  name: "NSIC Rc222",
  category: "inbred",
  typical_recovery_pct: "66.00",
  is_active: true,
};
const sinag = { ...rc222, id: "sinag", code: "SINAG", name: "Sinag (Hybrid)", is_active: false };

const draw = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

const openTab = async () => {
  draw();
  fireEvent.click(screen.getByRole("button", { name: "Rice Varieties" }));
  await screen.findByText("NSIC Rc222");
};

describe("Settings: Rice Varieties", () => {
  beforeEach(() => {
    useAuthStore.setState({ user: owner });
    vi.spyOn(billingService, "getPlans").mockResolvedValue([]);
    vi.spyOn(billingService, "getMyRequest").mockResolvedValue({ request: null });
    vi.spyOn(paddyService, "listVarieties").mockResolvedValue([rc222, sinag]);
    vi.spyOn(paddyService, "updateVariety").mockResolvedValue({});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useAuthStore.setState({ user: null });
  });

  it("edits a default variety", async () => {
    await openTab();
    fireEvent.click(screen.getByRole("button", { name: "Edit NSIC Rc222" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Variety name" }), {
      target: { value: "NSIC Rc222 (Tubigan 18)" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Typical recovery %" }), {
      target: { value: "67.5" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(paddyService.updateVariety).toHaveBeenCalledWith("rc222", {
        code: "Rc222",
        name: "NSIC Rc222 (Tubigan 18)",
        category: "inbred",
        typical_recovery_pct: 67.5,
      }),
    );
  });

  it("hides a shown variety", async () => {
    await openTab();
    fireEvent.click(screen.getByRole("button", { name: "Hide NSIC Rc222" }));
    await waitFor(() =>
      expect(paddyService.updateVariety).toHaveBeenCalledWith("rc222", { is_active: false }),
    );
  });

  it("unhides a hidden one from the hidden list", async () => {
    await openTab();
    expect(screen.queryByText("Sinag (Hybrid)")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Hidden varieties \(1\)/ }));
    fireEvent.click(screen.getByRole("button", { name: "Unhide Sinag (Hybrid)" }));
    await waitFor(() =>
      expect(paddyService.updateVariety).toHaveBeenCalledWith("sinag", { is_active: true }),
    );
  });
});
