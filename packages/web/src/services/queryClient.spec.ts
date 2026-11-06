import { QueryObserver } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { createSessionQueryClient } from "./queryClient";

/** Opens a page that reads `key`: a fresh observer, as a page mounting makes. */
function open(
  client: ReturnType<typeof createSessionQueryClient>,
  key: string,
  fn: () => unknown,
  staleTime?: number,
) {
  const observer = new QueryObserver(client, {
    queryKey: [key],
    queryFn: fn,
    ...(staleTime ? { staleTime } : {}),
  });
  return observer.subscribe(() => {});
}

describe("returning to a page", () => {
  it("draws the cached data and refetches it, even while still fresh", async () => {
    const client = createSessionQueryClient();
    const fetchSales = vi.fn(async () => ["sale"]);
    const leave = open(client, "sales", fetchSales);
    await vi.waitFor(() => expect(fetchSales).toHaveBeenCalledTimes(1));
    leave();

    open(client, "sales", fetchSales);

    expect(client.getQueryData(["sales"])).toEqual(["sale"]);
    await vi.waitFor(() => expect(fetchSales).toHaveBeenCalledTimes(2));
  });

  it("leaves a query with its own schedule alone while it is fresh", async () => {
    const client = createSessionQueryClient();
    const fetchWeather = vi.fn(async () => ({ rain: false }));
    const leave = open(client, "weather", fetchWeather, 30 * 60 * 1000);
    await vi.waitFor(() => expect(fetchWeather).toHaveBeenCalledTimes(1));
    leave();

    open(client, "weather", fetchWeather, 30 * 60 * 1000);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(fetchWeather).toHaveBeenCalledTimes(1);
  });
});
