import { test, expect } from "@playwright/test";
import { ADMIN, TENANT, login } from "./support/session";

test.describe("Authentication", () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
    await context.clearPermissions();
  });

  test("rejects invalid credentials", async ({ page }) => {
    await page.goto("/login");
    await page.getByPlaceholder("your.username").fill("nobody");
    await page.getByPlaceholder("••••••••").fill("wrongpassword");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();

    await expect(page.getByText(/invalid/i)).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test("platform admin logs in and lands on /admin", async ({ page }) => {
    await login(page, ADMIN);
    await expect(page).toHaveURL(/\/admin/);
  });

  test("tenant owner logs in and lands on the dashboard", async ({ page }) => {
    await login(page, TENANT);
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
  });

  test("the session survives a reload", async ({ page }) => {
    await login(page, TENANT);
    const urlAfterLogin = page.url();

    await page.reload();
    await expect(page).toHaveURL(urlAfterLogin);
    await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
  });

  test("a logged-out visitor to / sees the public homepage", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("link", { name: "Log in" }).first()).toBeVisible();
  });

  test("a logged-out deep link goes to the homepage, not the page", async ({ page }) => {
    await page.goto("/inventory");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("link", { name: "Log in" }).first()).toBeVisible();
  });
});
