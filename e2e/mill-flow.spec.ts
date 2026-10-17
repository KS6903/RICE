import { test, expect } from "@playwright/test";
import { login } from "./support/session";

/**
 * The mill's day through the real forms: buy palay, then sell milled rice and
 * bill the customer. (The milled rice comes from stock.setup.ts.)
 *
 * Runs after first-run.spec.ts, which needs the mill to have made no sale yet.
 */
test.describe("Buy and sell through the forms", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("record a palay purchase on the labelled form", async ({ page }) => {
    await page.goto("/paddy");
    // The purchases list, not the "Palay in stock" table above it: a purchase of
    // a variety and grade already in stock adds to that row instead of a new one.
    const rows = page.getByRole("region", { name: "Purchases" }).getByRole("listitem");
    // stock.setup.ts bought palay, so wait for the list to load before counting.
    await expect(rows.first()).toBeVisible();
    const before = await rows.count();

    await page.getByRole("button", { name: "New Purchase" }).click();
    // Variety and grade use the app's own dropdown: a button that opens a list.
    await page.getByRole("button", { name: "Variety", exact: true }).click();
    await page.getByRole("listbox").getByRole("option").first().click();
    await page.getByRole("button", { name: "Grade", exact: true }).click();
    await page.getByRole("listbox").getByRole("option").first().click();
    await page.getByLabel("Gross weight (kg)").fill("2000");
    await page.getByLabel("Tare: sacks (kg)").fill("20");
    await page.getByLabel("Moisture %").fill("14");
    await page.getByLabel("Price per cavan (₱)").fill("1150");
    await page.getByRole("button", { name: "Save Purchase" }).click();

    await expect(page.getByRole("heading", { name: "New Palay Purchase" })).toBeHidden();
    await expect(rows).toHaveCount(before + 1);
  });

  test("sell milled rice to a new customer, then invoice the order", async ({ page }) => {
    const customer = `E2E Buyer ${Date.now()}`;
    await page.goto("/sales");
    await page.getByRole("button", { name: "New Order" }).click();

    // A customer added from the order form is picked for it straight away.
    await page.getByRole("button", { name: "New customer" }).click();
    const quickAdd = page.getByRole("dialog");
    await quickAdd.getByLabel("Name").fill(customer);
    await quickAdd.getByLabel("Credit limit (₱)").fill("1000000");
    await quickAdd.getByRole("button", { name: "Save" }).click();
    await expect(quickAdd).toBeHidden();
    // Customer and rice use the app's own dropdown: a button that opens a list.
    await expect(page.getByRole("button", { name: "Customer", exact: true })).toContainText(
      customer,
    );

    await page.getByRole("button", { name: "Rice in stock" }).click();
    await page.getByRole("listbox").getByRole("option").first().click();
    await page.getByLabel("Quantity (kg)").fill("100");
    await page.getByLabel("Price per kg (₱)").fill("52");
    await page.getByRole("button", { name: "Create Order" }).click();

    const order = page.getByRole("row", { name: new RegExp(customer) });
    await expect(order).toBeVisible();
    await expect(order).toContainText("5,200");

    await order.getByRole("button", { name: "Generate invoice" }).click();
    const preview = page.getByRole("dialog", { name: "Preview invoice" });
    await expect(preview).toContainText(customer);
    await preview.getByTestId("confirm-generate-invoice").click();
    await expect(preview).toBeHidden();

    await page.getByRole("button", { name: "invoices", exact: true }).click();
    await expect(page.locator("tbody tr").filter({ hasText: "5,200" }).first()).toBeVisible();
  });
});
