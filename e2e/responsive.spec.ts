import { expect, test, type Locator, type Page } from "@playwright/test";
import { ADMIN, login } from "./support/session";

const millPages = [
  "/",
  "/paddy",
  "/rice",
  "/byproducts",
  "/milling",
  "/inventory",
  "/sales",
  "/dispatch",
  "/operators",
  "/costs",
  "/reports",
  "/users",
  "/employees",
  "/automations",
  "/maintenance",
  "/catalog",
  "/stock-count",
  "/tasks",
  "/collections",
  "/cash",
  "/settings",
];

async function containedHorizontally(locator: Locator, label: string) {
  const size = await locator.evaluate((element) => ({
    client: element.clientWidth,
    scroll: element.scrollWidth,
  }));
  expect(size.scroll, `${label} must fit without sideways page scrolling`).toBeLessThanOrEqual(
    size.client + 1,
  );
}

async function checkPages(page: Page, paths: string[]) {
  for (const path of paths) {
    await test.step(path, async () => {
      await page.goto(path);
      const main = page.locator(".app-main");
      await expect(main.locator("h1, h2").first()).toBeVisible();
      await expect(main.locator(".skeleton")).toHaveCount(0);
      await containedHorizontally(main, `${path} content`);
      await containedHorizontally(page.locator(".app-header"), `${path} header`);
      await containedHorizontally(page.locator("html"), `${path} document`);
    });
  }
}

for (const viewport of [
  { width: 320, height: 640 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1920, height: 1080 },
]) {
  test.describe(`Mill layout at ${viewport.width}px`, () => {
    test.use({ viewport, isMobile: viewport.width < 1024, hasTouch: viewport.width < 1024 });
    test("every operating page fits the screen", async ({ page }) => {
      test.setTimeout(240_000);
      await login(page);
      await checkPages(page, millPages);
    });
  });
}

for (const width of [320, 1024]) {
  test.describe(`Admin layout at ${width}px`, () => {
    test.use({ viewport: { width, height: 800 }, isMobile: width < 1024, hasTouch: width < 1024 });
    test("the console fits the screen", async ({ page }) => {
      test.setTimeout(120_000);
      await login(page, ADMIN);
      await checkPages(page, [
        "/admin",
        "/admin/tenants",
        "/admin/users",
        "/admin/upgrade-requests",
        "/admin/settings",
      ]);
    });
  });
}

test.describe("Short touch screens", () => {
  test.use({ viewport: { width: 640, height: 360 }, isMobile: true, hasTouch: true });

  test("a long stock dialog scrolls inside the screen and can be closed", async ({ page }) => {
    await login(page);
    await page.goto("/inventory");
    await page.getByTestId("add-inventory-btn").click();
    const panel = page.locator(".dialog-panel");
    await expect(panel).toBeVisible();
    const bounds = await panel.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(360);
    await containedHorizontally(panel, "Stock dialog");
    await panel.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect(panel.getByRole("button", { name: "Add stock", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
  });

  test("a dropdown stays reachable after the viewport becomes keyboard-sized", async ({ page }) => {
    await login(page);
    await page.goto("/inventory");
    await page.getByRole("button", { name: "Sort inventory by", exact: true }).click();
    await page.setViewportSize({ width: 320, height: 240 });
    const menu = page.getByRole("listbox");
    await expect(menu).toBeVisible();
    await expect
      .poll(async () => {
        const rect = await menu.boundingBox();
        return (
          !!rect &&
          rect.x >= 0 &&
          rect.y >= 0 &&
          rect.x + rect.width <= 320 &&
          rect.y + rect.height <= 240
        );
      })
      .toBe(true);
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
  });
});

test.describe("Phone forms", () => {
  test.use({ viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true });

  test("milling inputs stay readable instead of squeezing into four columns", async ({ page }) => {
    await login(page);
    await page.goto("/milling");
    await page.getByRole("button", { name: "New Batch", exact: true }).click();
    const main = page.locator(".app-main");
    await expect(
      page.getByRole("spinbutton", { name: "Palay weight (kg)", exact: true }),
    ).toBeVisible();
    await containedHorizontally(main, "Milling form");
    const fields = await main.locator("input.input").evaluateAll((inputs) =>
      inputs
        .filter((e) => e.getBoundingClientRect().width > 0)
        .map((e) => ({
          width: e.getBoundingClientRect().width,
          font: Number.parseFloat(getComputedStyle(e).fontSize),
        })),
    );
    expect(fields.length).toBeGreaterThan(0);
    expect(fields.every((e) => e.width >= 120 && e.font >= 16)).toBe(true);
  });
});

test("public pages fit narrow phones and tablets", async ({ page }) => {
  test.setTimeout(120_000);
  for (const width of [320, 768, 1024]) {
    await page.setViewportSize({ width, height: 800 });
    for (const path of ["/", "/login", "/signup", "/forgot-password"]) {
      await page.goto(path);
      await expect(page.getByRole("heading").first()).toBeVisible();
      await containedHorizontally(page.locator("html"), `${path} at ${width}px`);
    }
  }
});
