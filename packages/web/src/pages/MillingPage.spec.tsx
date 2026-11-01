import { afterEach, describe, expect, it, vi } from "vitest";
import { configure, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { User } from "@rice-mill/shared";
import MillingPage from "./MillingPage";
import { useAuthStore } from "../stores/authStore";
import { millingService } from "../services/MillingService";
import { paddyService } from "../services/PaddyService";
import { maintenanceService } from "../services/MaintenanceService";

configure({ asyncUtilTimeout: 5000 });

const owner: User = {
  id: "u1",
  username: "mill1",
  full_name: "Mill Owner",
  role: "owner",
  company_id: "c1",
  features: ["milling", "automations"],
};

const draw = (user: User, start = "/milling") => {
  useAuthStore.setState({ user });
  vi.spyOn(millingService, "listBatches").mockResolvedValue([]);
  vi.spyOn(millingService, "listEquipment").mockResolvedValue([]);
  vi.spyOn(millingService, "listClients").mockResolvedValue([]);
  vi.spyOn(millingService, "limits").mockResolvedValue(undefined as never);
  vi.spyOn(paddyService, "listVarieties").mockResolvedValue([]);
  vi.spyOn(maintenanceService, "list").mockResolvedValue({ equipment: [] });
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[start]}>
        <MillingPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe("MillingPage tabs", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    useAuthStore.setState({ user: null });
  });

  it("opens on the batches, and Maintenance is a tab beside them", async () => {
    draw(owner);
    expect(screen.getByRole("tab", { name: "Batches" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByText("No milling batches yet")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Maintenance" }));
    expect(await screen.findByText("No machines yet.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /New Batch/ })).not.toBeInTheDocument();
  });

  it("lands on Maintenance from a link to the tab", async () => {
    draw(owner, "/milling?tab=maintenance");
    expect(screen.getByRole("tab", { name: "Maintenance" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(await screen.findByText("No machines yet.")).toBeInTheDocument();
  });

  it("shows the Boss on a lower plan what Maintenance needs", () => {
    draw({ ...owner, features: ["milling"] });
    fireEvent.click(screen.getByRole("tab", { name: "Maintenance" }));
    expect(screen.getByText("Upgrade required")).toBeInTheDocument();
    expect(maintenanceService.list).not.toHaveBeenCalled();
  });

  it("shows staff on a lower plan no tabs at all", () => {
    draw({ ...owner, role: "encoder", features: ["milling"] });
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
  });
});
