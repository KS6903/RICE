import { test, expect } from "@playwright/test";
import { login } from "./support/session";

async function gotoCardsView(page: import("@playwright/test").Page) {
  await page.goto("/inventory");
  // Wait for the view switcher to render
  await expect(page.getByRole("button", { name: /^Cards$/ })).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: /^Cards$/ }).click();
}

async function gotoBinsView(page: import("@playwright/test").Page) {
  await page.goto("/inventory");
  await expect(page.getByRole("button", { name: /^Bins$/ })).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: /^Bins$/ }).click();
}

test.describe("Inventory — Cards & Bins polish", () => {
  test("Cards view renders polished inventory cards", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));

    await login(page);
    await gotoCardsView(page);

    // At least one card should render (seed data has stock)
    const cards = page.getByTestId("inventory-card");
    await expect(cards.first()).toBeVisible({ timeout: 10_000 });

    // Card shows kg unit and a percent chip
    await expect(cards.first().getByText(/kg/).first()).toBeVisible();
    await expect(cards.first().getByText(/%$/).first()).toBeVisible();

    expect(pageErrors, `page errors: ${pageErrors.join("\n")}`).toEqual([]);
  });

  test("Cards view puts palay, milled rice and by-products in separate scrollable rows", async ({
    page,
  }) => {
    await login(page);
    await gotoCardsView(page);

    for (const type of ["palay", "milled", "byproduct"]) {
      await expect(page.getByTestId(`cards-section-${type}`)).toBeVisible({ timeout: 10_000 });
    }
    // A kind with stock lays its cards out in one row that scrolls sideways.
    const row = page.getByTestId("cards-row-palay");
    await expect(row).toBeVisible();
    expect(await row.evaluate((el) => getComputedStyle(el).overflowX)).toBe("auto");
    const tops = await row
      .getByTestId("inventory-card")
      .evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
    expect(new Set(tops).size).toBe(1);
  });

  test("Clicking a card opens the detail drawer with full details", async ({ page }) => {
    await login(page);
    await gotoCardsView(page);

    const firstCard = page.getByTestId("inventory-card").first();
    await expect(firstCard).toBeVisible({ timeout: 10_000 });
    await firstCard.click();

    const drawer = page.getByTestId("inventory-drawer");
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText(/on hand/i)).toBeVisible();
    await expect(drawer.getByText(/cavans/i)).toBeVisible();
    await expect(drawer.getByText(/of total stock/i)).toBeVisible();
    // Two close buttons exist (icon header + footer text button); first() picks the icon one
    await expect(drawer.getByRole("button", { name: /close/i }).first()).toBeVisible();
  });

  test("Drawer closes on Escape key", async ({ page }) => {
    await login(page);
    await gotoCardsView(page);

    await page.getByTestId("inventory-card").first().click();
    await expect(page.getByTestId("inventory-drawer")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("inventory-drawer")).toBeHidden();
  });

  test("Drawer closes on backdrop click", async ({ page }) => {
    await login(page);
    await gotoCardsView(page);

    await page.getByTestId("inventory-card").first().click();
    await expect(page.getByTestId("inventory-drawer")).toBeVisible();

    // The backdrop is the first button inside the role=dialog with aria-label "Close drawer"
    await page.getByRole("button", { name: /close drawer/i }).click();
    await expect(page.getByTestId("inventory-drawer")).toBeHidden();
  });

  test("Bins view shows all three type sections with bars", async ({ page }) => {
    await login(page);
    await gotoBinsView(page);

    // All three sections should render — even empty ones now show a placeholder row
    await expect(page.getByTestId("bins-section-palay")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("bins-section-milled")).toBeVisible();
    await expect(page.getByTestId("bins-section-byproduct")).toBeVisible();

    // Each non-empty section's row count badge ends with "bins"
    await expect(page.getByText(/\d+ bins?/).first()).toBeVisible();
  });

  test("Clicking a bin row opens the drawer", async ({ page }) => {
    await login(page);
    await gotoBinsView(page);

    const firstRow = page.getByTestId("inventory-bin-row").first();
    await expect(firstRow).toBeVisible({ timeout: 10_000 });
    await firstRow.click();

    const drawer = page.getByTestId("inventory-drawer");
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText(/on hand/i)).toBeVisible();
  });

  test("Drawer 'Open in Warehouse' CTA switches to the warehouse view", async ({ page }) => {
    await login(page);
    await gotoCardsView(page);

    await page.getByTestId("inventory-card").first().click();
    const drawer = page.getByTestId("inventory-drawer");
    await expect(drawer).toBeVisible();

    const cta = drawer.getByRole("button", { name: /open in warehouse/i });
    // The CTA only renders when item has a branch — seed data always assigns one,
    // but guard so the test fails loudly if seed changes.
    await expect(cta).toBeVisible();
    await cta.click();

    // Drawer closes and Warehouse view loads
    await expect(page.getByTestId("inventory-drawer")).toBeHidden();
    await expect(page.getByText(/main branch warehouse/i).first()).toBeVisible({ timeout: 10_000 });
  });
});
