import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configure, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { User } from "@rice-mill/shared";
import DryingAdvisor from "./DryingAdvisor";
import { useAuthStore } from "../stores/authStore";
import { dryingAdvisorService } from "../services/DryingAdvisorService";
import type { HourlyForecast } from "../hooks/useWeather";

configure({ asyncUtilTimeout: 5000 });

const boss: User = {
  id: "u1",
  username: "mill1",
  full_name: "Mill Boss",
  role: "owner",
  company_id: "c1",
  features: ["*"],
};

/** 7 AM onward, dry until rain from 4 PM. */
const hourly: HourlyForecast[] = Array.from({ length: 24 }, (_, i) => {
  const hour = (7 + i) % 24;
  return {
    time: `2026-10-${i < 17 ? "22" : "23"}T${String(hour).padStart(2, "0")}:00`,
    temp_c: 30,
    condition: "Partly cloudy",
    condition_code: "partly_cloudy",
    precip_pct: hour >= 16 && i < 17 ? 70 : 10,
    is_daytime: hour >= 6 && hour < 18,
  };
});

const coords = { lat: 15.49, lon: 120.97 };
const KEY = "oraiza:drying-advice:15.49,120.97";

const draw = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } })}
    >
      <DryingAdvisor coords={coords} hourly={hourly} />
    </QueryClientProvider>,
  );

describe("DryingAdvisor", () => {
  beforeEach(() => {
    localStorage.clear();
    useAuthStore.setState({ user: boss });
  });
  afterEach(() => vi.restoreAllMocks());

  it("never says the advisor is unavailable: the forecast stands in for the AI", async () => {
    vi.spyOn(dryingAdvisorService, "get").mockRejectedValue(new Error("501"));
    draw();
    const line = await screen.findByTestId("drying-advisor");
    expect(line).toHaveTextContent(
      "Good drying weather until 3 PM. Spread the palay by 9 AM and bring it in before the rain.",
    );
    expect(line).toHaveAttribute("data-source", "forecast");
    expect(screen.queryByText(/unavailable/i)).not.toBeInTheDocument();
  });

  it("shows the AI's answer when it has one", async () => {
    vi.spyOn(dryingAdvisorService, "get").mockResolvedValue({
      verdict: "caution",
      headline: "Dry until early afternoon.",
      reasoning: "Showers are likely from 2 PM.",
      best_window: "9 AM to 1 PM",
      generated_at: "2026-10-22T07:00:00Z",
      location: { lat: 15.49, lon: 120.97, label: null },
      cached: true,
    });
    draw();
    const line = await screen.findByText("Dry until early afternoon.");
    expect(line.closest("[data-testid=drying-advisor]")).toHaveAttribute("data-source", "ai");
  });

  it("keeps the advice for an hour, so a reload doesn't ask again", async () => {
    const get = vi.spyOn(dryingAdvisorService, "get").mockRejectedValue(new Error("501"));
    const first = draw();
    await screen.findByTestId("drying-advisor");
    await vi.waitFor(() => expect(localStorage.getItem(KEY)).not.toBeNull());
    first.unmount();
    get.mockClear();

    draw(); // the reload
    expect(screen.getByTestId("drying-advisor")).toHaveTextContent(
      "Good drying weather until 3 PM.",
    );
    expect(get).not.toHaveBeenCalled();
  });

  it("asks again once the hour is up", async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        banner: { verdict: "good", headline: "Old advice.", detail: "", source: "ai" },
        savedAt: Date.now() - 61 * 60 * 1000,
      }),
    );
    const get = vi.spyOn(dryingAdvisorService, "get").mockRejectedValue(new Error("501"));
    draw();
    await vi.waitFor(() => expect(get).toHaveBeenCalled());
    expect(screen.queryByText("Old advice.")).not.toBeInTheDocument();
  });

  it("other plans see where to get it, and no request is made", () => {
    useAuthStore.setState({ user: { ...boss, features: ["dashboard"] } });
    const get = vi.spyOn(dryingAdvisorService, "get");
    draw();
    expect(screen.getByTestId("drying-advisor-upsell")).toHaveTextContent(
      "Palay drying advice comes with the Enterprise plan.",
    );
    expect(get).not.toHaveBeenCalled();
  });
});
