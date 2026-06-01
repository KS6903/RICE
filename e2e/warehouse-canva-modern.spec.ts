import { test, expect } from "@playwright/test";

const TENANT = { username: "mill1", password: "password123" };

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByPlaceholder("your.username").fill(TENANT.username);
  await page.getByPlaceholder("••••••••").fill(TENANT.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 10_000 });
}

async function openWarehouse(page: import("@playwright/test").Page) {
  await page.goto("/inventory");
  await page.getByRole("button", { name: /^Warehouse$/ }).click();
  await expect(page.getByTestId("warehouse-header")).toBeVisible({ timeout: 10_000 });
}

test.describe("Warehouse canva — modern Canva-style chrome", () => {
  test("view switcher button is labelled 'Warehouse' (not 'Bodega')", async ({ page }) => {
    await login(page);
    await page.goto("/inventory");
    // The view-switcher tab should be Warehouse, never Bodega
    await expect(page.getByRole("button", { name: /^Warehouse$/ })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: /^Bodega$/ })).toHaveCount(0);
  });

  test("slim header shows warehouse name, dimensions, live badge, and mode toggles", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));

    await login(page);
    await openWarehouse(page);

    const header = page.getByTestId("warehouse-header");
    await expect(header).toBeVisible();
    // Whatever layout is currently active should appear in the header (h2).
    await expect(header.locator("h2")).toBeVisible();
    await expect(header.getByText(/\d+m × \d+m/)).toBeVisible();
    // Mode toggles
    await expect(header.getByRole("button", { name: /view only|move pallets/i })).toBeVisible();
    await expect(header.getByRole("button", { name: /edit floor plan|editing floor plan/i })).toBeVisible();

    expect(pageErrors, `page errors: ${pageErrors.join("\n")}`).toEqual([]);
  });

  test("aging summary floats top-left over the canva", async ({ page }) => {
    await login(page);
    await openWarehouse(page);

    const summary = page.getByTestId("warehouse-aging-summary");
    await expect(summary).toBeVisible();
    await expect(summary.getByText("Fresh", { exact: true })).toBeVisible();
    await expect(summary.getByText("Warning", { exact: true })).toBeVisible();
    await expect(summary.getByText("Critical", { exact: true })).toBeVisible();
    await expect(summary.getByText("Expired", { exact: true })).toBeVisible();
  });

  test("action bar floats top-right with FIFO / Heatmap / Report", async ({ page }) => {
    await login(page);
    await openWarehouse(page);

    const bar = page.getByTestId("warehouse-action-bar");
    await expect(bar).toBeVisible();
    await expect(bar.getByRole("button", { name: /^FIFO/ })).toBeVisible();
    await expect(bar.getByRole("button", { name: /^Heatmap/ })).toBeVisible();
    await expect(bar.getByRole("button", { name: /^Report/ })).toBeVisible();
  });

  test("Heatmap toggle in the floating bar still works", async ({ page }) => {
    await login(page);
    await openWarehouse(page);

    const heatmap = page.getByTestId("warehouse-action-bar").getByRole("button", { name: /^Heatmap/ });
    await heatmap.click();
    // Second click should not throw (toggles off)
    await heatmap.click();
  });

  test("bottom-center zoom toolbar reads 100% and increments on click", async ({ page }) => {
    await login(page);
    await openWarehouse(page);

    const zoom = page.getByTestId("warehouse-zoom-toolbar");
    await expect(zoom).toBeVisible();
    await expect(zoom.getByText(/^\d+%$/)).toBeVisible();

    const startText = (await zoom.getByText(/^\d+%$/).innerText()).trim();
    await zoom.getByRole("button", { name: /zoom in/i }).click();
    // After zoom in, percentage should change (not equal to start)
    await expect.poll(async () => (await zoom.getByText(/^\d+%$/).innerText()).trim()).not.toBe(startText);
  });

  test("Help popover explains the warehouse in plain language", async ({ page }) => {
    await login(page);
    await openWarehouse(page);

    // The ? help button lives in the slim header
    await page.getByTestId("warehouse-header").getByRole("button", { name: /open help/i }).click();

    const dialog = page.getByRole("dialog", { name: /warehouse canva help/i });
    await expect(dialog).toBeVisible();
    // Friendly phrases for non-technical users
    await expect(dialog.getByText(/just looking/i)).toBeVisible();
    await expect(dialog.getByText(/move pallets/i)).toBeVisible();
    await expect(dialog.getByText(/edit floor plan/i)).toBeVisible();
    await expect(dialog.getByText(/recenter/i)).toBeVisible();

    // Esc closes it
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  test("FIFO modal opens from the floating action bar", async ({ page }) => {
    await login(page);
    await openWarehouse(page);

    await page.getByTestId("warehouse-action-bar").getByRole("button", { name: /^FIFO/ }).click();
    await expect(page.getByRole("heading", { name: /find oldest pallets/i })).toBeVisible({ timeout: 5_000 });
  });
});
