import { test, expect } from "@playwright/test";
import { login } from "./support/session";

/**
 * What a brand-new user meets: the getting-started checklist, links that open
 * the right form, the guided tour behind the ? button, the grouped menu, and
 * empty pages that say what to do.
 *
 * stock.setup.ts has already recorded a purchase and a milling batch, and no
 * spec before this one (files run in name order, one at a time) sells, logs an
 * expense or adds a user. So the checklist stands at 2 of 5.
 */
test.describe("First run", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("the dashboard checklist ticks off done steps and opens the next form", async ({ page }) => {
    const checklist = page.getByRole("region", { name: "Get your mill running" });
    await expect(checklist).toBeVisible();
    await expect(checklist).toContainText("2 of 5 done");

    // Done steps have no link left; the rest each open their form.
    await expect(checklist.getByRole("link", { name: /Record a purchase/ })).toHaveCount(0);
    await expect(checklist.getByRole("link", { name: /Start a batch/ })).toHaveCount(0);
    await checklist.getByRole("link", { name: /Create an order/ }).click();

    await expect(page).toHaveURL(/\/sales$/);
    await expect(page.getByRole("heading", { name: "New Sales Order" })).toBeVisible();
  });

  test("a ?new=1 link opens the form, then drops the flag", async ({ page }) => {
    await page.goto("/paddy?new=1");
    await expect(page.getByRole("heading", { name: "New Palay Purchase" })).toBeVisible();
    await expect(page).toHaveURL(/\/paddy$/);
  });

  test("hiding the checklist sticks, and the end of the tour brings it back", async ({ page }) => {
    // Walks every stop of the tour, opening each page.
    test.slow();
    const checklist = page.getByRole("region", { name: "Get your mill running" });
    await checklist.getByRole("button", { name: "Hide" }).click();
    await expect(checklist).toBeHidden();
    await page.reload();
    await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
    await expect(checklist).toBeHidden();

    await page.getByRole("button", { name: "Take the tour" }).click();
    await page.getByRole("button", { name: "Start tour" }).click();
    // Walk to the last stop with the arrow keys.
    const tour = page.getByRole("dialog");
    while (!(await tour.getByRole("button", { name: "Done" }).isVisible())) {
      await page.keyboard.press("ArrowRight");
    }
    await expect(tour).toHaveAccessibleName("That's the tour");
    await tour.getByRole("button", { name: "Bring back the getting-started checklist" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(checklist).toBeVisible();
  });

  test("the ? button walks through the app page by page", async ({ page }) => {
    await page.goto("/costs");
    await page.getByRole("button", { name: "Take the tour" }).click();

    const tour = page.getByRole("dialog");
    await expect(tour).toHaveAccessibleName("Welcome to Oryza");
    await tour.getByRole("button", { name: "Start tour" }).click();

    await expect(tour).toHaveAccessibleName("Dashboard");
    await expect(page).toHaveURL(/\/$/);
    await expect(tour).toContainText(/1 of \d+/);

    await tour.getByRole("button", { name: "Next" }).click();
    await expect(tour).toHaveAccessibleName("Paddy / Palay");
    await expect(page).toHaveURL(/\/paddy$/);

    await tour.getByRole("button", { name: "Back" }).click();
    await expect(tour).toHaveAccessibleName("Dashboard");

    // Esc ends it where you are.
    await page.keyboard.press("Escape");
    await expect(tour).toBeHidden();
    await expect(page).toHaveURL(/\/$/);
  });

  test("finishing the tour returns to the page it started on", async ({ page }) => {
    // Walks every stop of the tour, opening each page.
    test.slow();
    await page.goto("/costs");
    await page.getByRole("button", { name: "Take the tour" }).click();
    await page.getByRole("button", { name: "Start tour" }).click();
    const tour = page.getByRole("dialog");
    while (!(await tour.getByRole("button", { name: "Done" }).isVisible())) {
      await page.keyboard.press("ArrowRight");
    }
    await tour.getByRole("button", { name: "Done" }).click();
    await expect(tour).toBeHidden();
    await expect(page).toHaveURL(/\/costs$/);
  });

  test("the menu is grouped in the order a mill works, with a hint per page", async ({ page }) => {
    const nav = page.getByRole("navigation");
    for (const heading of ["Buy & mill", "Stock", "Sell", "Money", "Team"]) {
      await expect(nav.getByText(heading, { exact: true })).toBeVisible();
    }
    await expect(nav.getByRole("link", { name: "Paddy / Palay" })).toHaveAttribute(
      "title",
      /palay you buy/i,
    );
  });

  test("an empty page says what it's for and offers the first step", async ({ page }) => {
    await page.goto("/costs");
    await expect(page.getByText("No expenses recorded")).toBeVisible();
    await page.getByRole("button", { name: "Add your first expense" }).click();
    await expect(page.getByRole("heading", { name: "Add Expense" })).toBeVisible();
  });
});
