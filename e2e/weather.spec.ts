import { test, expect, Page } from "@playwright/test";

const TENANT = { username: "mill1", password: "password123" };

async function login(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("your.username").fill(TENANT.username);
  await page.getByPlaceholder("••••••••").fill(TENANT.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 10_000 });
}

/** Open the topbar location picker and add the first search result for `query`.
 *  Returns the label the backend persisted. */
async function addFavorite(page: Page, query: string): Promise<string> {
  await page.getByTestId("location-picker-trigger").click();
  const popover = page.getByTestId("location-picker-popover");
  await expect(popover).toBeVisible();
  await popover.getByTestId("location-search-input").fill(query);
  const results = popover.getByTestId("search-results");
  await expect(results.getByTestId("search-hit-0")).toBeVisible({ timeout: 8_000 });
  const label = await results.getByTestId("search-hit-0").innerText();
  await results.getByTestId("search-hit-0").click();
  // Popover closes, weather widget re-renders for the new default.
  await expect(popover).not.toBeVisible({ timeout: 5_000 });
  return label.trim();
}

/** Wipe any leftover favorites for the test user so each spec starts clean. */
async function purgeFavorites(page: Page) {
  const token = await page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem("rice-mill-auth") || "{}").state?.accessToken ?? null; }
    catch { return null; }
  });
  if (!token) return;
  const res = await fetch("http://localhost:8000/api/locations", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return;
  const list: { id: string }[] = await res.json();
  await Promise.all(
    list.map((l) => fetch(`http://localhost:8000/api/locations/${l.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    })),
  );
}

test.describe("Weather + saved locations — header dropdown, search, favorites", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    // Purge favorites between tests so the IP/GPS fallback shows when expected.
    await page.evaluate(async () => {
      const token = (() => { try { return JSON.parse(localStorage.getItem("rice-mill-auth") || "{}").state?.accessToken ?? null; } catch { return null; } })();
      if (!token) return;
      const r = await fetch("http://localhost:8000/api/locations", { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) return;
      const list = await r.json();
      await Promise.all(list.map((l: any) =>
        fetch(`http://localhost:8000/api/locations/${l.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }),
      ));
    });
  });

  test("Topbar picker is present on every tab and renders a temperature", async ({ page }) => {
    await page.goto("/");
    const trigger = page.getByTestId("location-picker-trigger");
    await expect(trigger).toBeVisible({ timeout: 15_000 });
    await expect(trigger.getByTestId("weather-temp")).toContainText(/°C/i, { timeout: 15_000 });

    for (const path of ["/inventory", "/sales", "/dispatch", "/settings"]) {
      await page.goto(path);
      await expect(page.getByTestId("location-picker-trigger"), `picker missing on ${path}`).toBeVisible();
    }
  });

  test("Search a city, save it as a favorite, and have its weather follow next login", async ({ page, context }) => {
    await page.goto("/");
    const label = await addFavorite(page, "Manila");
    expect(label).toMatch(/manila/i);

    // The header pill should now show the saved label
    const trigger = page.getByTestId("location-picker-trigger");
    await expect(trigger.getByTestId("weather-location")).toContainText(/manila/i, { timeout: 10_000 });

    // Logout + log back in — the favorite persists server-side
    await context.clearCookies();
    await page.evaluate(() => localStorage.clear());
    await login(page);
    await page.goto("/");
    await expect(page.getByTestId("location-picker-trigger").getByTestId("weather-location"))
      .toContainText(/manila/i, { timeout: 15_000 });

    await purgeFavorites(page);
  });

  test("Saving multiple favorites and switching default updates the widget", async ({ page }) => {
    await page.goto("/");
    await addFavorite(page, "Manila");
    await addFavorite(page, "Cebu");

    // Open picker; the most-recently-added (Cebu) should be the default chip
    await page.getByTestId("location-picker-trigger").click();
    const popover = page.getByTestId("location-picker-popover");
    await expect(popover).toBeVisible();

    // Click Manila's star to flip the default
    const rows = popover.locator('[data-testid^="favorite-"]');
    await expect(rows).toHaveCount(2);
    const manilaRow = popover.locator('[data-testid^="favorite-"]', { hasText: /manila/i }).first();
    await manilaRow.locator('[data-testid^="star-"]').click();

    // Manila is now default — weather pill reflects that
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("location-picker-trigger").getByTestId("weather-location"))
      .toContainText(/manila/i, { timeout: 10_000 });

    await purgeFavorites(page);
  });

  test("Deleting a favorite removes it from the dropdown", async ({ page }) => {
    await page.goto("/");
    await addFavorite(page, "Tokyo");

    await page.getByTestId("location-picker-trigger").click();
    const popover = page.getByTestId("location-picker-popover");
    const row = popover.locator('[data-testid^="favorite-"]').first();
    await row.locator('[data-testid^="delete-"]').click();
    await expect(popover.locator('[data-testid^="favorite-"]')).toHaveCount(0, { timeout: 5_000 });

    await purgeFavorites(page);
  });

  test("Search input rejects unsafe characters (XSS/HTML)", async ({ page, request }) => {
    const token = await page.evaluate(() => {
      try { return JSON.parse(localStorage.getItem("rice-mill-auth") || "{}").state?.accessToken ?? null; }
      catch { return null; }
    });
    if (!token) throw new Error("No auth token in localStorage");

    const r = await request.get(
      "http://localhost:8000/api/locations/search?q=" + encodeURIComponent("<script>alert(1)</script>"),
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(r.status()).toBe(400);
    const body = await r.json();
    expect(body.detail).toMatch(/only contain letters/i);
  });

  test("Backend /api/weather still works when the user has no favorites", async ({ page, request }) => {
    await page.goto("/");
    await purgeFavorites(page);
    const token = await page.evaluate(() => {
      try { return JSON.parse(localStorage.getItem("rice-mill-auth") || "{}").state?.accessToken ?? null; }
      catch { return null; }
    });
    if (!token) throw new Error("No auth token in localStorage");

    const r = await request.get("http://localhost:8000/api/weather", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(r.ok()).toBeTruthy();
    const body = await r.json();
    expect(typeof body.temp_c).toBe("number");
    expect(typeof body.location.lat).toBe("number");
  });

  test("Anonymous request to /api/locations/search is rejected (auth required)", async ({ request }) => {
    const r = await request.get("http://localhost:8000/api/locations/search?q=Manila");
    // Either 401 (token missing) or 403 — anything but 200.
    expect(r.ok()).toBeFalsy();
    expect([401, 403]).toContain(r.status());
  });
});
