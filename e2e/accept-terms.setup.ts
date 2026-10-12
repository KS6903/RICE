import { test as setup, expect } from "@playwright/test";
import { login } from "./support/session";

/**
 * A new mill's owner must accept the terms before the app opens. Do it once,
 * through the real screen, so every test after this lands in the app.
 */
setup("the owner accepts the terms on first sign-in", async ({ page }) => {
  await login(page);
  await expect(page.getByRole("heading", { name: /terms have been updated/i })).toBeVisible();

  const accept = page.getByRole("button", { name: /Accept and continue/ });
  await expect(accept).toBeDisabled();
  await page.getByRole("checkbox").check();
  await accept.click();

  await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
});
