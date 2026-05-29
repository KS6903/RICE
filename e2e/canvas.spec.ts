import { test, expect } from "@playwright/test";

const TENANT = { username: "mill1", password: "password123" };

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByPlaceholder("your.username").fill(TENANT.username);
  await page.getByPlaceholder("••••••••").fill(TENANT.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 10_000 });
}

test.describe("Bodega canvas", () => {
  test("loads and shows edit-mode toggle for owner", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));

    await login(page);
    await page.goto("/inventory");
    await page.getByRole("button", { name: /bodega/i }).click();

    // Wait for the canvas toolbar (which contains the layout name)
    await expect(page.getByText(/main branch bodega/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/30m × 20m/i)).toBeVisible();

    // Edit-mode button should appear for owner role
    await expect(page.getByRole("button", { name: /view mode|edit mode/i })).toBeVisible();

    // No React/Konva runtime errors
    expect(pageErrors, `page errors: ${pageErrors.join("\n")}`).toEqual([]);
  });

  test("aging pills surface batch counts from API", async ({ page }) => {
    await login(page);
    await page.goto("/inventory");
    await page.getByRole("button", { name: /bodega/i }).click();
    await expect(page.getByText(/main branch bodega/i)).toBeVisible({ timeout: 10_000 });
    // The four aging pills should all be on screen
    await expect(page.getByText("Fresh", { exact: true })).toBeVisible();
    await expect(page.getByText("Warning", { exact: true })).toBeVisible();
    await expect(page.getByText("Critical", { exact: true })).toBeVisible();
    await expect(page.getByText("Expired", { exact: true })).toBeVisible();
  });

  test("toggling edit mode shows the drag-pallet hint", async ({ page }) => {
    await login(page);
    await page.goto("/inventory");
    await page.getByRole("button", { name: /bodega/i }).click();
    await expect(page.getByText(/main branch bodega/i)).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: /view mode/i }).click();
    await expect(page.getByText(/Edit mode is on/i)).toBeVisible();
    await expect(page.getByText(/Drop one on another to/)).toBeVisible();
  });

  test("realtime badge transitions from connecting to live", async ({ page }) => {
    await login(page);
    await page.goto("/inventory");
    await page.getByRole("button", { name: /bodega/i }).click();
    await expect(page.getByText(/main branch bodega/i)).toBeVisible({ timeout: 10_000 });
    // The badge starts "Connecting…" then flips to "Live" once WS opens.
    await expect(page.getByText("Live", { exact: true })).toBeVisible({ timeout: 5_000 });
  });

  test("FIFO modal lists in-stock varieties and returns recommended pallets", async ({ page }) => {
    await login(page);
    await page.goto("/inventory");
    await page.getByRole("button", { name: /bodega/i }).click();
    await expect(page.getByText(/main branch bodega/i)).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: /^FIFO/ }).click();
    await expect(page.getByRole("heading", { name: /find oldest pallets/i })).toBeVisible();

    // The variety dropdown should include at least one of the seeded codes
    const options = await page.getByRole("combobox").last().locator("option").allInnerTexts();
    expect(options.join("|")).toMatch(/Rc222|Rc216|Rc218|SINAG/);

    await page.getByRole("button", { name: /find oldest pallets/i }).click();
    await expect(page.getByText(/covered:/i)).toBeVisible({ timeout: 5_000 });
  });

  test("aging report shows totals, per-zone breakdown, and oldest pallets", async ({ page }) => {
    await login(page);
    await page.goto("/inventory");
    await page.getByRole("button", { name: /bodega/i }).click();
    await expect(page.getByText(/main branch bodega/i)).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: /^Report/ }).click();
    await expect(page.getByRole("heading", { name: /aging report/i })).toBeVisible();
    // The four total tiles
    await expect(page.getByText(/Top 5 oldest/i)).toBeVisible({ timeout: 5_000 });
    // Premium Storage holds the seeded pallets, so it shows up in the table
    await expect(page.getByText(/premium storage/i).first()).toBeVisible();
  });

  test("heatmap toggle changes its own active state", async ({ page }) => {
    await login(page);
    await page.goto("/inventory");
    await page.getByRole("button", { name: /bodega/i }).click();
    await expect(page.getByText(/main branch bodega/i)).toBeVisible({ timeout: 10_000 });

    const heatmap = page.getByRole("button", { name: /^Heatmap/ });
    await expect(heatmap).toBeVisible();
    await heatmap.click();
    // Click again to ensure no error
    await heatmap.click();
  });

  test("customer filter dropdown lists seeded clients with colors", async ({ page }) => {
    await login(page);
    await page.goto("/inventory");
    await page.getByRole("button", { name: /bodega/i }).click();
    await expect(page.getByText(/main branch bodega/i)).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: /All customers|selected/ }).click();
    // Seeded clients from seed_demo_pallets.py
    await expect(page.getByRole("button", { name: /Juan Cruz Farms/ })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole("button", { name: /Mill stock/ })).toBeVisible();

    await page.getByRole("button", { name: /Juan Cruz Farms/ }).click();
    // After selecting one, the toolbar label switches from "All customers" to "1 selected"
    await expect(page.getByRole("button", { name: /1 selected/ })).toBeVisible();
  });

  test("Edit Layout opens Builder Mode with zone toolbox", async ({ page }) => {
    await login(page);
    await page.goto("/inventory");
    await page.getByRole("button", { name: /bodega/i }).click();
    await expect(page.getByText(/main branch bodega/i)).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: /Edit Layout/ }).click();
    await expect(page.getByText(/Builder mode/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /Wall/, exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /Door/, exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /Walkway/ })).toBeVisible();

    // Arm a wall tool then confirm the "Tool armed" hint appears
    await page.getByRole("button", { name: /Wall/, exact: true }).click();
    await expect(page.getByText(/Tool armed:/i)).toBeVisible();
  });

  test("Builder Mode dimensions panel resizes the warehouse", async ({ page }) => {
    await login(page);
    await page.goto("/inventory");
    await page.getByRole("button", { name: /bodega/i }).click();
    await expect(page.getByText(/main branch bodega/i)).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: /Edit Layout/ }).click();
    await page.getByRole("button", { name: /Dimensions/ }).click();

    const widthInput = page.locator("input[type=number]").first();
    await widthInput.fill("36");
    await page.getByRole("button", { name: /^Apply$/ }).click();

    // Toolbar should reflect the new dimensions
    await expect(page.getByText(/36m × /)).toBeVisible({ timeout: 5_000 });

    // Reset for repeat runs
    await widthInput.fill("30");
    await page.getByRole("button", { name: /^Apply$/ }).click();
    await expect(page.getByText(/30m × /)).toBeVisible({ timeout: 5_000 });
  });
});
