import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { format, subDays } from "date-fns";
import type { User } from "@rice-mill/shared";
import SettingsPage from "./SettingsPage";
import { useAuthStore } from "../stores/authStore";
import { billingService } from "../services/BillingService";
import { activityService } from "../services/ActivityService";

const owner: User = {
  id: "u1",
  username: "mill1",
  full_name: "Mill Owner",
  role: "owner",
  company_id: "c1",
  features: [],
};

const day = (daysAgo: number) => format(subDays(new Date(), daysAgo), "yyyy-MM-dd");

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

describe("Settings: Activity Log", () => {
  beforeEach(() => {
    useAuthStore.setState({ user: owner });
    vi.spyOn(billingService, "getPlans").mockResolvedValue([]);
    vi.spyOn(billingService, "getMyRequest").mockResolvedValue({ request: null });
    vi.spyOn(activityService, "list").mockResolvedValue([]);
    draw();
    fireEvent.click(screen.getByRole("button", { name: "Activity Log" }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useAuthStore.setState({ user: null });
  });

  it("shows the last month by default", async () => {
    await waitFor(() =>
      expect(activityService.list).toHaveBeenCalledWith({ start: day(30), end: day(0) }),
    );
    expect(screen.getByLabelText("From")).toHaveValue(day(30));
    expect(screen.getByLabelText("To")).toHaveValue(day(0));
  });

  it("looks at other days, keeping to 31 at a time", async () => {
    fireEvent.change(screen.getByLabelText("From"), { target: { value: day(90) } });
    // The end follows the start, so the range stays 31 days long.
    await waitFor(() =>
      expect(activityService.list).toHaveBeenLastCalledWith({ start: day(90), end: day(60) }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Last month" }));
    await waitFor(() =>
      expect(activityService.list).toHaveBeenLastCalledWith({ start: day(30), end: day(0) }),
    );
  });
});
