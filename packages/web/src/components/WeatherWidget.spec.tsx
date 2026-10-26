import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import WeatherWidget from "./WeatherWidget";

const weather = vi.hoisted(() => ({
  current: {
    provider: "google",
    temp_c: 29,
    feels_like_c: 32,
    humidity_pct: 67,
    wind_kph: 4,
    condition: "Light rain",
    condition_code: "rain_light",
    is_daytime: true,
    location: { lat: 14.6, lon: 121, label: "Manila" },
    fetched_at: "",
  },
}));

vi.mock("../hooks/useActiveLocation", () => ({
  useActiveLocation: () => ({ lat: 14.6, lon: 121, label: "Manila", source: "saved" }),
}));
vi.mock("../hooks/useWeather", () => ({
  useWeather: () => ({ isLoading: false, isError: false, data: weather.current }),
  useForecast: () => ({
    isLoading: false,
    isError: false,
    data: {
      provider: "open-meteo",
      hourly: [
        {
          time: "2026-10-26T13:00",
          temp_c: 30,
          condition: "Light rain",
          condition_code: "rain_light",
          precip_pct: 60,
          is_daytime: true,
        },
        {
          time: "2026-10-26T14:00",
          temp_c: 31,
          condition: "Cloudy",
          condition_code: "cloudy",
          precip_pct: 20,
          is_daytime: true,
        },
      ],
      daily: [
        {
          date: "2026-10-26",
          temp_max_c: 31,
          temp_min_c: 25,
          condition: "Rain",
          condition_code: "rain",
          precip_pct: 80,
        },
        {
          date: "2026-10-27",
          temp_max_c: 32,
          temp_min_c: 26,
          condition: "Clear",
          condition_code: "clear",
          precip_pct: 0,
        },
      ],
    },
  }),
}));
vi.mock("./DryingAdvisor", () => ({ default: () => <div data-testid="drying-advisor" /> }));

describe("WeatherWidget expanded card", () => {
  it("names where the weather comes from", () => {
    render(<WeatherWidget variant="expanded" />);
    expect(screen.getByTestId("weather-attribution")).toHaveTextContent(
      "Powered by Google Weather",
    );
  });

  it("shows the hours, starting now, behind the Hourly switch", () => {
    render(<WeatherWidget variant="expanded" />);
    expect(screen.queryByTestId("hourly-forecast")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Hourly" }));
    const hours = screen.getByTestId("hourly-forecast");
    expect(hours.children).toHaveLength(2);
    expect(hours).toHaveTextContent("Now");
    expect(hours).toHaveTextContent("2 PM");
    expect(screen.queryByTestId("drying-advisor")).toBeNull();
    expect(screen.queryByTestId("daily-forecast")).toBeNull();
    expect(screen.getByTestId("weather-attribution")).toHaveTextContent("Powered by Open-Meteo");
  });

  it("switches between today and the next 7 days", () => {
    render(<WeatherWidget variant="expanded" />);
    expect(screen.getByTestId("drying-advisor")).toBeInTheDocument();
    expect(screen.queryByTestId("daily-forecast")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "7 days" }));
    expect(screen.getByTestId("daily-forecast").children).toHaveLength(2);
    expect(screen.queryByTestId("drying-advisor")).toBeNull();
    expect(screen.queryByTestId("hourly-forecast")).toBeNull();
    // The 7 days always come from Open-Meteo, so that is what it says.
    expect(screen.getByTestId("weather-attribution")).toHaveTextContent("Powered by Open-Meteo");
    expect(screen.getByTestId("weather-attribution")).not.toHaveTextContent("Google");

    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(screen.getByTestId("drying-advisor")).toBeInTheDocument();
  });
});
