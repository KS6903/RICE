import { test, expect } from "@playwright/test";

const ADMIN = { username: "admin", password: "admin1234" };
const TENANT = { username: "mill1", password: "password123" };

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
    await page.goto("/login");
    await page.getByPlaceholder("your.username").fill(ADMIN.username);
    await page.getByPlaceholder("••••••••").fill(ADMIN.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();

    await expect(page).toHaveURL(/\/admin/, { timeout: 10_000 });
  });

  test("tenant owner logs in and lands on dashboard", async ({ page }) => {
    await page.goto("/login");
    await page.getByPlaceholder("your.username").fill(TENANT.username);
    await page.getByPlaceholder("••••••••").fill(TENANT.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();

    await expect(page).not.toHaveURL(/\/login/, { timeout: 10_000 });
    await expect(page).not.toHaveURL(/\/admin/);
  });

  test("auth token persists across reload", async ({ page }) => {
    await page.goto("/login");
    await page.getByPlaceholder("your.username").fill(TENANT.username);
    await page.getByPlaceholder("••••••••").fill(TENANT.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();

    await expect(page).not.toHaveURL(/\/login/, { timeout: 10_000 });
    const urlAfterLogin = page.url();

    await page.reload();
    await expect(page).toHaveURL(urlAfterLogin);
    await expect(page).not.toHaveURL(/\/login/);
  });

  test("unauthenticated visit to / redirects to /login", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/, { timeout: 5_000 });
  });
});
