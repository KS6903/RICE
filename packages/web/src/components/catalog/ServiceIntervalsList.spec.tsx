import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ServiceIntervalsList } from "./ServiceIntervalsList";
import { maintenanceService, type Machine } from "../../services/MaintenanceService";

const huller: Machine = {
  id: "m1",
  name: "Rubber-roll huller",
  every_hours: 500,
  every_tonnes: null,
  every_days: 30,
  last_service_on: "2026-10-01",
  notes: "Rolls from Satake",
  is_active: true,
  used: { hours: 120, tonnes: 40, days: 23 },
  status: "ok",
  summary: "120 of 500 running hours",
};

const draw = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ServiceIntervalsList />
    </QueryClientProvider>,
  );

describe("Catalog: Service intervals", () => {
  beforeEach(() => {
    vi.spyOn(maintenanceService, "list").mockResolvedValue({ equipment: [huller] });
  });
  afterEach(() => vi.restoreAllMocks());

  it("shows each machine's intervals, whichever comes first", async () => {
    draw();
    const row = (await screen.findByText("Rubber-roll huller")).closest("tr")!;
    expect(within(row).getByText("500 running hours or 30 days")).toBeInTheDocument();
    expect(within(row).getByText("In use")).toBeInTheDocument();
  });

  it("changes an interval and keeps the rest of the machine as it was", async () => {
    const edit = vi.spyOn(maintenanceService, "edit").mockResolvedValue(huller);
    draw();
    fireEvent.click(await screen.findByRole("button", { name: "Edit Rubber-roll huller" }));
    fireEvent.change(screen.getByLabelText("Every (running hours)"), { target: { value: "600" } });
    fireEvent.change(screen.getByLabelText("Every (tonnes of palay milled)"), {
      target: { value: "75.5" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(edit).toHaveBeenCalledWith("m1", {
        name: "Rubber-roll huller",
        every_hours: 600,
        every_tonnes: 75.5,
        every_days: 30,
        last_service_on: "2026-10-01",
        notes: "Rolls from Satake",
        is_active: true,
      }),
    );
  });

  it("won't save a machine with no interval", async () => {
    draw();
    fireEvent.click(await screen.findByRole("button", { name: "Edit Rubber-roll huller" }));
    fireEvent.change(screen.getByLabelText("Every (running hours)"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Every (days)"), { target: { value: "" } });
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });
});
