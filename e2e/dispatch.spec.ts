import { test, expect, Page, APIRequestContext } from "@playwright/test";

const TENANT = { username: "mill1", password: "password123" };
const BACKEND = "http://localhost:8000";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("your.username").fill(TENANT.username);
  await page.getByPlaceholder("••••••••").fill(TENANT.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 10_000 });
}

/** Bearer token via a direct API login. Session tokens live in httpOnly cookies
 *  now (not localStorage), so direct-API tests fetch their own token here. */
async function apiToken(request: APIRequestContext): Promise<string> {
  const res = await request.post(`${BACKEND}/api/auth/login`, {
    form: { username: TENANT.username, password: TENANT.password },
    headers: { "X-Client-Type": "bearer" },
  });
  expect(res.ok(), `api login failed (${res.status()})`).toBeTruthy();
  return (await res.json()).access_token;
}

/** Navigate to /operators, create an operator, and return its reserved color hex. */
async function createOperator(page: Page, kind: "agent" | "miller", name: string): Promise<string> {
  await page.goto("/operators");
  await page.getByTestId("add-operator").click();
  await page.getByTestId(`new-operator-kind-${kind}`).click();
  await page.getByTestId("new-operator-name").fill(name);
  await page.getByTestId("save-new-operator").click();
  const row = page.getByRole("row", { name: new RegExp(name, "i") }).first();
  await expect(row).toBeVisible({ timeout: 10_000 });
  const color = await row.getByTestId("color-swatch").first().getAttribute("data-color");
  if (!color) throw new Error(`${kind} row has no color swatch`);
  return color;
}

test.describe("Dispatch & Field Operators — color reservation, edit flow", () => {
  test("Dispatch page renders delivery content and Field Operators page renders operator table", async ({
    page,
  }) => {
    await login(page);

    await page.goto("/dispatch");
    await expect(page.getByRole("heading", { name: /^Dispatch$/i })).toBeVisible({
      timeout: 10_000,
    });
    const table = page.getByTestId("dispatch-orders-table");
    const emptyMsg = page.getByText(/no orders awaiting delivery/i);
    await expect(table.or(emptyMsg)).toBeVisible({ timeout: 10_000 });

    await page.goto("/operators");
    await expect(page.getByRole("heading", { name: /^Field Operators$/i })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId("operators-filter-all")).toBeVisible();
    // Old per-type tabs are gone — both kinds live under Field Operators now.
    await expect(page.getByTestId("dispatch-tab-agents")).toHaveCount(0);
    await expect(page.getByTestId("dispatch-tab-millers")).toHaveCount(0);
  });

  test("Adding an operator auto-assigns a unique color that persists across reload", async ({
    page,
  }) => {
    await login(page);
    const name = `E2E Op ${Date.now()}`;
    const color = await createOperator(page, "agent", name);
    expect(color).toMatch(/^#[0-9a-f]{6}$/);

    await page.reload();
    const row = page.getByRole("row", { name: new RegExp(name, "i") }).first();
    await expect(row).toBeVisible({ timeout: 10_000 });
    const still = await row.getByTestId("color-swatch").first().getAttribute("data-color");
    expect(still).toBe(color);
  });

  test("Agent and miller in the same tenant get different system-assigned colors (swatch is read-only)", async ({
    page,
  }) => {
    await login(page);
    const stamp = Date.now();
    const agentColor = await createOperator(page, "agent", `E2E A ${stamp}`);
    const millerColor = await createOperator(page, "miller", `E2E M ${stamp}`);
    expect(agentColor).not.toBe(millerColor);

    // No editable picker anywhere in the miller row.
    const millerRow = page.getByRole("row", { name: new RegExp(`E2E M ${stamp}`, "i") }).first();
    await expect(millerRow.getByTestId("palette-popover")).toHaveCount(0);
    await expect(millerRow.locator('input[type="color"]')).toHaveCount(0);
    await expect(millerRow.getByText(/^Auto$/)).toBeVisible();
  });

  test("Backend silently drops any client-supplied canva_color_hex on agent create/update", async ({
    request,
  }) => {
    const token = await apiToken(request);

    const stamp = Date.now();
    const created = await request.post("http://localhost:8000/api/agents", {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      data: { name: `E2E NoUserColor ${stamp}`, canva_color_hex: "#000000" },
    });
    expect(created.ok()).toBeTruthy();
    const body = await created.json();
    expect(body.canva_color_hex).not.toBe("#000000");
    expect(body.canva_color_hex).toMatch(/^#[0-9a-f]{6}$/);

    const updated = await request.put(`http://localhost:8000/api/agents/${body.id}`, {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      data: { canva_color_hex: "#000000", contact_person: "Edited" },
    });
    expect(updated.ok()).toBeTruthy();
    const after = await updated.json();
    expect(after.canva_color_hex).toBe(body.canva_color_hex);
    expect(after.contact_person).toBe("Edited");
  });

  test("User can edit an agent's contact info inline (but the color stays put)", async ({
    page,
  }) => {
    await login(page);
    const stamp = Date.now();
    const name = `E2E Edit ${stamp}`;
    const originalColor = await createOperator(page, "agent", name);

    const row = page.getByRole("row", { name: new RegExp(name, "i") }).first();
    await row.getByRole("button", { name: /^Edit$/ }).click();

    const editRow = page.locator(`[data-testid^="operator-edit-"]`).first();
    await editRow.getByPlaceholder("Phone").fill("0917-555-1234");
    await editRow.getByPlaceholder("Contact person").fill("Juan dela Cruz");
    await editRow.getByRole("button", { name: /^Save$/ }).click();

    const refreshedRow = page.getByRole("row", { name: new RegExp(name, "i") }).first();
    await expect(refreshedRow.getByText("Juan dela Cruz")).toBeVisible({ timeout: 6_000 });
    await expect(refreshedRow.getByText("0917-555-1234")).toBeVisible();

    const stillColor = await refreshedRow
      .getByTestId("color-swatch")
      .first()
      .getAttribute("data-color");
    expect(stillColor).toBe(originalColor);
  });

  test("Type filter pills narrow the operator list to a single kind", async ({ page }) => {
    await login(page);
    const stamp = Date.now();
    const aName = `E2E FilterA ${stamp}`;
    const mName = `E2E FilterM ${stamp}`;
    await createOperator(page, "agent", aName);
    await createOperator(page, "miller", mName);

    // Filter to agents only — miller row hides
    await page.getByTestId("operators-filter-agent").click();
    await expect(page.getByRole("row", { name: new RegExp(aName, "i") })).toBeVisible();
    await expect(page.getByRole("row", { name: new RegExp(mName, "i") })).toHaveCount(0);

    // Filter to millers only — agent row hides
    await page.getByTestId("operators-filter-miller").click();
    await expect(page.getByRole("row", { name: new RegExp(mName, "i") })).toBeVisible();
    await expect(page.getByRole("row", { name: new RegExp(aName, "i") })).toHaveCount(0);

    // "All" shows both again
    await page.getByTestId("operators-filter-all").click();
    await expect(page.getByRole("row", { name: new RegExp(aName, "i") })).toBeVisible();
    await expect(page.getByRole("row", { name: new RegExp(mName, "i") })).toBeVisible();
  });

  test("Order Delivery page renders the orders table or an empty-state", async ({ page }) => {
    await login(page);
    await page.goto("/dispatch");
    const table = page.getByTestId("dispatch-orders-table");
    const emptyMsg = page.getByText(/no orders awaiting delivery/i);
    await expect(table.or(emptyMsg)).toBeVisible({ timeout: 10_000 });
  });
});
