import { expect, type APIRequestContext, type Page } from "@playwright/test";

/** Accounts seeded by backend/start_disposable_e2e.py. */
export const TENANT = { username: "mill1", password: "password123" };
export const ADMIN = { username: "admin", password: "admin1234" };

/** Sign in through the login form and wait to leave it. */
export async function login(page: Page, who = TENANT): Promise<void> {
  await page.goto("/login");
  await page.getByPlaceholder("your.username").fill(who.username);
  await page.getByPlaceholder("••••••••").fill(who.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });
}

/** A bearer token from a direct API login. Browser sessions live in httpOnly
 *  cookies, so tests that call the API themselves get their own token. Goes
 *  through the web server's /api proxy, like the app does. */
export async function apiToken(request: APIRequestContext, who = TENANT): Promise<string> {
  const res = await request.post("/api/auth/login", {
    form: { username: who.username, password: who.password },
    headers: { "X-Client-Type": "bearer" },
  });
  expect(res.ok(), `api login failed (${res.status()})`).toBeTruthy();
  return (await res.json()).access_token;
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
