import { afterEach, describe, expect, it, vi } from "vitest";
import { configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { User } from "@rice-mill/shared";
import MaintenancePage from "./MaintenancePage";
import { useAuthStore } from "../stores/authStore";
import { maintenanceService, type Machine } from "../services/MaintenanceService";

configure({ asyncUtilTimeout: 5000 });

const owner: User = {
  id: "u1",
  username: "mill1",
  full_name: "Mill Owner",
  role: "owner",
  company_id: "c1",
};

const huller: Machine = {
  id: "m1",
  name: "Rubber-roll huller",
  every_hours: 20,
  every_tonnes: null,
  every_days: null,
  last_service_on: "2026-09-01",
  notes: null,
  is_active: true,
  used: { hours: 22, tonnes: 2, days: 28 },
  status: "due",
  summary: "22 of 20 running hours",
};

const draw = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <MaintenancePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe("MaintenancePage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    useAuthStore.setState({ user: null });
  });

  it("shows a machine due, and records its service", async () => {
    useAuthStore.setState({ user: owner });
    vi.spyOn(maintenanceService, "list").mockResolvedValue({ equipment: [huller] });
    const service = vi
      .spyOn(maintenanceService, "service")
      .mockResolvedValue({ ...huller, status: "ok" });
    draw();
    const card = await screen.findByRole("article", { name: "Rubber-roll huller" });
    expect(within(card).getByText("Service due")).toBeInTheDocument();
    expect(within(card).getByText(/22 of 20 running hours/)).toBeInTheDocument();
    fireEvent.click(within(card).getByRole("button", { name: /Record a service/ }));
    fireEvent.change(within(card).getByLabelText("Done on"), { target: { value: "2026-09-28" } });
    fireEvent.change(within(card).getByLabelText("What was done"), {
      target: { value: "New rolls." },
    });
    fireEvent.click(within(card).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(service).toHaveBeenCalledWith("m1", { done_on: "2026-09-28", note: "New rolls." }),
    );
  });

  it("adds a machine with the manufacturer's intervals", async () => {
    useAuthStore.setState({ user: owner });
    vi.spyOn(maintenanceService, "list").mockResolvedValue({ equipment: [] });
    const add = vi.spyOn(maintenanceService, "add").mockResolvedValue(huller);
    draw();
    expect(await screen.findByText("No machines yet.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Add a machine/ }));
    const form = screen.getByRole("region", { name: "Add a machine" });
    fireEvent.change(within(form).getByLabelText("Machine"), { target: { value: "Polisher" } });
    fireEvent.change(within(form).getByLabelText("Last serviced on"), {
      target: { value: "2026-09-01" },
    });
    fireEvent.change(within(form).getByLabelText(/tonnes/), { target: { value: "500" } });
    fireEvent.click(within(form).getByRole("button", { name: "Add the machine" }));
    await waitFor(() =>
      expect(add).toHaveBeenCalledWith({
        name: "Polisher",
        every_hours: null,
        every_tonnes: 500,
        every_days: null,
        last_service_on: "2026-09-01",
        notes: "",
      }),
    );
  });
});
