import { test, expect } from "@playwright/test";

const TENANT = { username: "mill1", password: "password123" };

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByPlaceholder("your.username").fill(TENANT.username);
  await page.getByPlaceholder("••••••••").fill(TENANT.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 10_000 });
}

test.describe("Warehouse canva", () => {
  test("loads and shows edit-mode toggle for owner", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));

    await login(page);
    await page.goto("/inventory");
    await page.getByRole("button", { name: /^Warehouse$/ }).click();

    // Wait for the canva toolbar (which contains the layout name)
    await expect(page.getByText(/main branch warehouse/i).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/30m × \d+m/i).first()).toBeVisible();

    // Edit-mode button should appear for owner role
    await expect(page.getByRole("button", { name: /view only|move pallets/i })).toBeVisible();

    // No React/Konva runtime errors
    expect(pageErrors, `page errors: ${pageErrors.join("\n")}`).toEqual([]);
  });

  test("aging pills surface batch counts from API", async ({ page }) => {
    await login(page);
    await page.goto("/inventory");
    await page.getByRole("button", { name: /^Warehouse$/ }).click();
    await expect(page.getByText(/main branch warehouse/i).first()).toBeVisible({ timeout: 10_000 });
    // The four aging pills should all be on screen
    await expect(page.getByText("Fresh", { exact: true })).toBeVisible();
    await expect(page.getByText("Warning", { exact: true })).toBeVisible();
    await expect(page.getByText("Critical", { exact: true })).toBeVisible();
    await expect(page.getByText("Expired", { exact: true })).toBeVisible();
  });

  test("toggling edit mode shows the drag-pallet hint", async ({ page }) => {
    await login(page);
    await page.goto("/inventory");
    await page.getByRole("button", { name: /^Warehouse$/ }).click();
    await expect(page.getByText(/main branch warehouse/i).first()).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: /view only/i }).click();
    await expect(page.getByText(/Move mode is on/i)).toBeVisible();
    await expect(page.getByText(/Drop one pallet on top of another/i)).toBeVisible();
  });

  test("realtime badge transitions from connecting to live", async ({ page }) => {
    await login(page);
    await page.goto("/inventory");
    await page.getByRole("button", { name: /^Warehouse$/ }).click();
    await expect(page.getByText(/main branch warehouse/i).first()).toBeVisible({ timeout: 10_000 });
    // The badge starts "Connecting…" then flips to "Live" once WS opens.
    await expect(page.getByText("Live", { exact: true })).toBeVisible({ timeout: 5_000 });
  });

  test("FIFO modal lists in-stock varieties and returns recommended pallets", async ({ page }) => {
    await login(page);
    await page.goto("/inventory");
    await page.getByRole("button", { name: /^Warehouse$/ }).click();
    await expect(page.getByText(/main branch warehouse/i).first()).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: /^FIFO/ }).click();
    await expect(page.getByRole("heading", { name: /find oldest pallets/i })).toBeVisible();

    // Wait for varieties to load asynchronously (> 1 option means "Any variety" + real data)
    await page.waitForFunction(() => {
      const selects = document.querySelectorAll("select");
      const last = selects[selects.length - 1];
      return last && last.options.length > 1;
    }, undefined, { timeout: 5_000 });

    // The variety dropdown should include at least one of the seeded codes
    const options = await page.getByRole("combobox").last().locator("option").allInnerTexts();
    expect(options.join("|")).toMatch(/Rc222|Rc216|Rc218|SINAG/);

    await page.getByRole("button", { name: /find oldest pallets/i }).click();
    await expect(page.getByText(/covered:/i)).toBeVisible({ timeout: 5_000 });
  });

  test("aging report shows totals, per-zone breakdown, and oldest pallets", async ({ page }) => {
    await login(page);
    await page.goto("/inventory");
    await page.getByRole("button", { name: /^Warehouse$/ }).click();
    await expect(page.getByText(/main branch warehouse/i).first()).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: /^Report/ }).click();
    await expect(page.getByRole("heading", { name: /aging report/i })).toBeVisible();
    // The four total tiles
    await expect(page.getByText(/Top 5 oldest/i)).toBeVisible({ timeout: 5_000 });
  });

  test("heatmap toggle changes its own active state", async ({ page }) => {
    await login(page);
    await page.goto("/inventory");
    await page.getByRole("button", { name: /^Warehouse$/ }).click();
    await expect(page.getByText(/main branch warehouse/i).first()).toBeVisible({ timeout: 10_000 });

    const heatmap = page.getByRole("button", { name: /^Heatmap/ });
    await expect(heatmap).toBeVisible();
    await heatmap.click();
    // Click again to ensure no error
    await heatmap.click();
  });

  test("customer filter dropdown lists seeded clients with colors", async ({ page }) => {
    await login(page);
    await page.goto("/inventory");
    await page.getByRole("button", { name: /^Warehouse$/ }).click();
    await expect(page.getByText(/main branch warehouse/i).first()).toBeVisible({ timeout: 10_000 });

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
    await page.getByRole("button", { name: /^Warehouse$/ }).click();
    await expect(page.getByText(/main branch warehouse/i).first()).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: /Edit floor plan/i }).click();
    await expect(page.getByText(/Floor-plan editor/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /Wall/, exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /Door/, exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /Walkway/ })).toBeVisible();

    // Arm a wall tool then confirm the "Tool armed" hint appears
    await page.getByRole("button", { name: /Wall/, exact: true }).click();
    await expect(page.getByText(/Tool armed:/i)).toBeVisible();
  });

  test("multi-layout: layout tab bar is visible with at least one layout", async ({ page }) => {
    await login(page);
    await page.goto("/inventory");
    await page.getByRole("button", { name: /^Warehouse$/ }).click();
    // The layout tab bar card should be visible
    await expect(page.getByRole("button", { name: /New layout/i })).toBeVisible({ timeout: 10_000 });
    // The warehouse header always shows the active layout's dimensions chip
    // regardless of which layout is currently active.
    await expect(page.getByTestId("warehouse-header").getByText(/\d+m × \d+m/)).toBeVisible();
  });

  test("multi-layout: create, switch to, and delete a new layout", async ({ page }) => {
    await login(page);
    await page.goto("/inventory");
    await page.getByRole("button", { name: /^Warehouse$/ }).click();
    await expect(page.getByRole("button", { name: /New layout/i })).toBeVisible({ timeout: 10_000 });

    // Create a new layout via the popover form
    await page.getByRole("button", { name: /New layout/i }).click();
    const popover = page.getByTestId("new-layout-modal");
    await expect(popover).toBeVisible();
    const layoutName = `E2E Layout ${Date.now()}`;
    await popover.locator("input").first().fill(layoutName);
    await popover.getByRole("button", { name: /^Create layout$/i }).click();

    // New layout tab should appear (first match = tab bar label)
    await expect(page.getByText(layoutName).first()).toBeVisible({ timeout: 8_000 });

    // Register dialog handler BEFORE triggering the confirm()
    page.once("dialog", (dialog) => dialog.accept());

    // Delete action lives in the single action bar now (per active layout).
    // The new layout was auto-selected on create, so the action bar acts on it.
    await page.getByTestId("layout-action-bar").getByRole("button", { name: /^Delete$/ }).click();

    // Tab should be gone from both tab bar and canva toolbar
    await expect(page.getByText(layoutName).first()).not.toBeVisible({ timeout: 8_000 });
  });

  test("multi-layout: size shown in tab bar matches the layout dimensions", async ({ page }) => {
    await login(page);
    await page.goto("/inventory");
    await page.getByRole("button", { name: /^Warehouse$/ }).click();
    await expect(page.getByRole("button", { name: /New layout/i })).toBeVisible({ timeout: 10_000 });
    // The dimension badge (e.g. "30m × 20m") should appear at the right edge of the tab bar
    await expect(page.getByText(/\d+m × \d+m/).first()).toBeVisible({ timeout: 5_000 });
  });

  test("Builder Mode dimensions panel resizes the warehouse", async ({ page }) => {
    await login(page);
    await page.goto("/inventory");
    await page.getByRole("button", { name: /^Warehouse$/ }).click();
    await expect(page.getByText(/main branch warehouse/i).first()).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: /Edit floor plan/i }).click();
    await page.getByRole("button", { name: /Dimensions/ }).click();

    const widthInput = page.locator("input[type=number]").first();
    await widthInput.fill("36");
    await page.getByRole("button", { name: /^Apply$/ }).click();

    // Toolbar should reflect the new dimensions
    await expect(page.getByText(/36m × /).first()).toBeVisible({ timeout: 5_000 });

    // Reset for repeat runs
    await widthInput.fill("30");
    await page.getByRole("button", { name: /^Apply$/ }).click();
    await expect(page.getByText(/30m × /).first()).toBeVisible({ timeout: 5_000 });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Door / structural zone freedom tests
// ──────────────────────────────────────────────────────────────────────────────

test.describe("Door (pinto) zone placement", () => {
  /** Helper — log in, open Warehouse, enter Builder mode, return canva bounding box. */
  async function enterBuilderMode(page: import("@playwright/test").Page) {
    await page.goto("/login");
    await page.getByPlaceholder("your.username").fill(TENANT.username);
    await page.getByPlaceholder("••••••••").fill(TENANT.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).not.toHaveURL(/\/login/, { timeout: 10_000 });

    await page.goto("/inventory");
    await page.getByRole("button", { name: /^Warehouse$/ }).click();
    await expect(page.getByText(/main branch warehouse/i).first()).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: /Edit floor plan/i }).click();
    await expect(page.getByText(/Floor-plan editor/i)).toBeVisible();

    const canva = page.locator("canva").first();
    await expect(canva).toBeVisible();
    return canva;
  }

  test("Door tool is present in structural toolbox and can be armed", async ({ page }) => {
    const canva = await enterBuilderMode(page);
    await expect(page.getByRole("button", { name: /Door/, exact: true })).toBeVisible();

    await page.getByRole("button", { name: /Door/, exact: true }).click();
    await expect(page.getByText(/Tool armed: Door/i)).toBeVisible();
    // Canva cursor changes to crosshair when armed
    const cursor = await canva.evaluate((el: HTMLCanvaElement) => el.style.cursor || "default");
    // Disarm by clicking again
    await page.getByRole("button", { name: /Door/, exact: true }).click();
    await expect(page.getByText(/Tool armed/i)).not.toBeVisible();
  });

  test("Door zone placed on canva opens ZoneEditor with structural badge", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));

    const canva = await enterBuilderMode(page);
    const box = await canva.boundingBox();
    if (!box) throw new Error("Canva not found");

    // Arm Door tool
    await page.getByRole("button", { name: /Door/, exact: true }).click();
    await expect(page.getByText(/Tool armed: Door/i)).toBeVisible();

    // Click near the top-centre of the canva — maps to coordinates at the very
    // top edge of the warehouse floor (y < 1 m, before any zone starts).
    // The floating chrome panels above use pointer-events-none on their wrappers
    // so clicks pass through to the canva everywhere except on their buttons.
    // force:true is required because Playwright sees the canva as "intercepted"
    // by overlapping DOM siblings (the toolbox card).
    await canva.click({ position: { x: box!.width * 0.5, y: 15 }, force: true });

    // ZoneEditor should open automatically for the newly placed zone
    await expect(page.getByText(/Structural element — cannot hold pallets/i)).toBeVisible({ timeout: 6_000 });

    // The zone type select should show "door" (or "Door" label)
    const typeSelect = page.locator("select").filter({ hasText: /door/i });
    await expect(typeSelect).toBeVisible();

    expect(pageErrors).toEqual([]);
  });

  test("Door zone created via API at negative coordinates is not auto-corrected", async ({ page, request }) => {
    // Log in via API to get a token
    const loginRes = await request.post("http://localhost:8000/api/auth/login", {
      form: { username: TENANT.username, password: TENANT.password },
      headers: { "X-Client-Type": "bearer" },
    });
    const { access_token } = await loginRes.json();
    const headers = { Authorization: `Bearer ${access_token}` };

    // Get the branch
    const branchRes = await request.get("http://localhost:8000/api/branches/", { headers });
    const branches = await branchRes.json();
    const branchId = branches[0].id;

    // Get the layout
    const layoutsRes = await request.get(`http://localhost:8000/api/branches/${branchId}/layouts`, { headers });
    const layouts = await layoutsRes.json();
    const layoutId = layouts.find((l: any) => l.is_default)?.id ?? layouts[0]?.id;

    // Create a door zone at negative coordinates (outside the floor)
    const createRes = await request.post(
      `http://localhost:8000/api/warehouses/${branchId}/zones?layout_id=${layoutId}`,
      {
        headers: { ...headers, "Content-Type": "application/json" },
        data: { zone_type: "door", name: "E2E Outside Door", x_m: -1.0, y_m: -1.0, width_m: 1.0, height_m: 2.0 },
      },
    );
    expect(createRes.ok()).toBeTruthy();
    const created = await createRes.json();

    // Backend must NOT clamp structural zone coordinates to the floor boundary
    expect(created.x_m).toBe(-1.0);
    expect(created.y_m).toBe(-1.0);

    // Load the page — the zone should exist without being auto-corrected on load
    await page.goto("/login");
    await page.getByPlaceholder("your.username").fill(TENANT.username);
    await page.getByPlaceholder("••••••••").fill(TENANT.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).not.toHaveURL(/\/login/, { timeout: 10_000 });

    await page.goto("/inventory");
    await page.getByRole("button", { name: /^Warehouse$/ }).click();
    await expect(page.getByText(/main branch warehouse/i).first()).toBeVisible({ timeout: 10_000 });

    // Give React Query time to fetch and render
    await page.waitForTimeout(1_500);

    // Verify the zone was NOT auto-corrected by re-reading from the API
    const readRes = await request.get(
      `http://localhost:8000/api/warehouses/${branchId}/canva?layout_id=${layoutId}`,
      { headers },
    );
    const canva = await readRes.json();
    const doorZone = canva.zones.find((z: any) => z.id === created.id);
    expect(doorZone, "Zone should still exist").toBeTruthy();
    expect(doorZone.x_m).toBe(-1.0);
    expect(doorZone.y_m).toBe(-1.0);

    // Clean up
    await request.delete(`http://localhost:8000/api/zones/${created.id}`, { headers });
  });

  test("Door zone can be renamed and deleted via ZoneEditor", async ({ page }) => {
    const canva = await enterBuilderMode(page);
    const box = await canva.boundingBox();
    // Arm Door tool and place a zone
    await page.getByRole("button", { name: /Door/, exact: true }).click();
    await expect(page.getByText(/Tool armed: Door/i)).toBeVisible();
    // Click near the bottom of the canva — past the last zone row (y > 19 m).
    // force:true bypasses the "intercepted" check for <canva> elements.
    await canva.click({ position: { x: (box?.width ?? 900) * 0.5, y: (box?.height ?? 600) - 15 }, force: true });

    // Wait for ZoneEditor to appear
    await expect(page.getByText(/Structural element — cannot hold pallets/i)).toBeVisible({ timeout: 6_000 });

    // Scope to the editor's scrollable body — the .overflow-y-auto div that also
    // contains the structural badge. The first input inside it is the Name field.
    const editorBody = page.locator(".overflow-y-auto").filter({
      has: page.getByText(/Structural element/i),
    });
    const nameInput = editorBody.locator("input").first();
    await nameInput.clear();
    await nameInput.fill("Pinto Norte");
    await nameInput.press("Tab"); // triggers onBlur → zoneUpdateMutation

    // ZoneEditor header re-renders with new name after optimistic cache update
    await expect(page.getByText("Pinto Norte").first()).toBeVisible({ timeout: 5_000 });

    // Register dialog handler before triggering confirm()
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: /Delete zone/i }).click();

    // Reload to confirm backend removed the zone (CSS transition keeps element
    // detectable by Playwright even after logical deletion).
    await page.reload();
    await page.getByRole("button", { name: /^Warehouse$/ }).click();
    await expect(page.getByText(/main branch warehouse/i).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Pinto Norte")).toHaveCount(0);
  });

  test("Wall and Walkway tools are also free to place outside floor", async ({ page }) => {
    await enterBuilderMode(page);

    for (const toolName of ["Wall", "Walkway"]) {
      await page.getByRole("button", { name: new RegExp(`^${toolName}$`) }).click();
      await expect(page.getByText(new RegExp(`Tool armed: ${toolName}`, "i"))).toBeVisible();
      // Disarm
      await page.getByRole("button", { name: new RegExp(`^${toolName}$`) }).click();
      await expect(page.getByText(/Tool armed/i)).not.toBeVisible();
    }
  });
});
