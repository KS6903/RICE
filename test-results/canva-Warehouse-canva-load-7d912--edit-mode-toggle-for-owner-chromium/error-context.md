# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: canva.spec.ts >> Warehouse canva >> loads and shows edit-mode toggle for owner
- Location: e2e\canva.spec.ts:14:7

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText(/main branch warehouse/i).first()
Expected: visible
Timeout: 10000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 10000ms
  - waiting for getByText(/main branch warehouse/i).first()

```

```yaml
- complementary:
  - img
  - heading "Rice Mill" [level=1]
  - paragraph: Pilipinas · ERP
  - navigation:
    - paragraph: Operations
    - link "Dashboard":
      - /url: /
      - img
      - text: Dashboard
    - link "Paddy / Palay":
      - /url: /paddy
      - img
      - text: Paddy / Palay
    - link "Milling":
      - /url: /milling
      - img
      - text: Milling
    - link "Inventory":
      - /url: /inventory
      - img
      - text: Inventory
    - link "Sales":
      - /url: /sales
      - img
      - text: Sales
    - link "Dispatch":
      - /url: /dispatch
      - img
      - text: Dispatch
    - link "Expenses":
      - /url: /costs
      - img
      - text: Expenses
    - link "Reports":
      - /url: /reports
      - img
      - text: Reports
    - link "Employees":
      - /url: /employees
      - img
      - text: Employees
    - link "Users":
      - /url: /users
      - img
      - text: Users
  - link "Settings":
    - /url: /settings
    - img
    - text: Settings
- banner:
  - img
  - textbox "Search transactions, batches, customers…"
  - button "29°C Dinalongan, Philippines":
    - img
    - text: 29°C Dinalongan, Philippines
    - img
  - img
  - text: Online
  - link "Enterprise":
    - /url: /settings
    - img
    - text: Enterprise
  - button "Toggle theme":
    - img
  - text: RM
  - paragraph: Rice Mill 1 Owner
  - paragraph: owner
  - button "Sign out":
    - img
- main:
  - heading "Inventory" [level=2]
  - paragraph: Stock of palay, milled rice, and by-products — 5 ways to view it
  - button "All warehouses (11)":
    - img
    - text: All warehouses (11)
    - img
  - button "Classic":
    - img
    - text: Classic
  - button "Spreadsheet":
    - img
    - text: Spreadsheet
  - button "Cards":
    - img
    - text: Cards
  - button "Bins":
    - img
    - text: Bins
  - button "Warehouse":
    - img
    - text: Warehouse
  - img
  - heading "Visual Warehouse Canvas — a Pro feature" [level=3]:
    - img
    - text: Visual Warehouse Canvas — a Pro feature
  - paragraph: Drag-and-drop your pallets across a floor plan of your warehouse. See aging at a glance, stack visually, dispatch oldest-first, and watch live moves from any device.
  - link "Upgrade plan":
    - /url: /settings
    - text: Upgrade plan
    - img
  - paragraph: Available on Pro and Enterprise
```

# Test source

```ts
  1   | import { test, expect } from "@playwright/test";
  2   | 
  3   | const TENANT = { username: "mill1", password: "password123" };
  4   | 
  5   | async function login(page: import("@playwright/test").Page) {
  6   |   await page.goto("/login");
  7   |   await page.getByPlaceholder("your.username").fill(TENANT.username);
  8   |   await page.getByPlaceholder("••••••••").fill(TENANT.password);
  9   |   await page.getByRole("button", { name: /sign in/i }).click();
  10  |   await expect(page).not.toHaveURL(/\/login/, { timeout: 10_000 });
  11  | }
  12  | 
  13  | test.describe("Warehouse canva", () => {
  14  |   test("loads and shows edit-mode toggle for owner", async ({ page }) => {
  15  |     const pageErrors: string[] = [];
  16  |     page.on("pageerror", (e) => pageErrors.push(e.message));
  17  | 
  18  |     await login(page);
  19  |     await page.goto("/inventory");
  20  |     await page.getByRole("button", { name: /^Warehouse$/ }).click();
  21  | 
  22  |     // Wait for the canva toolbar (which contains the layout name)
> 23  |     await expect(page.getByText(/main branch warehouse/i).first()).toBeVisible({ timeout: 10_000 });
      |                                                                    ^ Error: expect(locator).toBeVisible() failed
  24  |     await expect(page.getByText(/30m × \d+m/i).first()).toBeVisible();
  25  | 
  26  |     // Edit-mode button should appear for owner role
  27  |     await expect(page.getByRole("button", { name: /view only|move pallets/i })).toBeVisible();
  28  | 
  29  |     // No React/Konva runtime errors
  30  |     expect(pageErrors, `page errors: ${pageErrors.join("\n")}`).toEqual([]);
  31  |   });
  32  | 
  33  |   test("aging pills surface batch counts from API", async ({ page }) => {
  34  |     await login(page);
  35  |     await page.goto("/inventory");
  36  |     await page.getByRole("button", { name: /^Warehouse$/ }).click();
  37  |     await expect(page.getByText(/main branch warehouse/i).first()).toBeVisible({ timeout: 10_000 });
  38  |     // The four aging pills should all be on screen
  39  |     await expect(page.getByText("Fresh", { exact: true })).toBeVisible();
  40  |     await expect(page.getByText("Warning", { exact: true })).toBeVisible();
  41  |     await expect(page.getByText("Critical", { exact: true })).toBeVisible();
  42  |     await expect(page.getByText("Expired", { exact: true })).toBeVisible();
  43  |   });
  44  | 
  45  |   test("toggling edit mode shows the drag-pallet hint", async ({ page }) => {
  46  |     await login(page);
  47  |     await page.goto("/inventory");
  48  |     await page.getByRole("button", { name: /^Warehouse$/ }).click();
  49  |     await expect(page.getByText(/main branch warehouse/i).first()).toBeVisible({ timeout: 10_000 });
  50  |     await page.getByRole("button", { name: /view only/i }).click();
  51  |     await expect(page.getByText(/Move mode is on/i)).toBeVisible();
  52  |     await expect(page.getByText(/Drop one pallet on top of another/i)).toBeVisible();
  53  |   });
  54  | 
  55  |   test("realtime badge transitions from connecting to live", async ({ page }) => {
  56  |     await login(page);
  57  |     await page.goto("/inventory");
  58  |     await page.getByRole("button", { name: /^Warehouse$/ }).click();
  59  |     await expect(page.getByText(/main branch warehouse/i).first()).toBeVisible({ timeout: 10_000 });
  60  |     // The badge starts "Connecting…" then flips to "Live" once WS opens.
  61  |     await expect(page.getByText("Live", { exact: true })).toBeVisible({ timeout: 5_000 });
  62  |   });
  63  | 
  64  |   test("FIFO modal lists in-stock varieties and returns recommended pallets", async ({ page }) => {
  65  |     await login(page);
  66  |     await page.goto("/inventory");
  67  |     await page.getByRole("button", { name: /^Warehouse$/ }).click();
  68  |     await expect(page.getByText(/main branch warehouse/i).first()).toBeVisible({ timeout: 10_000 });
  69  | 
  70  |     await page.getByRole("button", { name: /^FIFO/ }).click();
  71  |     await expect(page.getByRole("heading", { name: /find oldest pallets/i })).toBeVisible();
  72  | 
  73  |     // Wait for varieties to load asynchronously (> 1 option means "Any variety" + real data)
  74  |     await page.waitForFunction(() => {
  75  |       const selects = document.querySelectorAll("select");
  76  |       const last = selects[selects.length - 1];
  77  |       return last && last.options.length > 1;
  78  |     }, undefined, { timeout: 5_000 });
  79  | 
  80  |     // The variety dropdown should include at least one of the seeded codes
  81  |     const options = await page.getByRole("combobox").last().locator("option").allInnerTexts();
  82  |     expect(options.join("|")).toMatch(/Rc222|Rc216|Rc218|SINAG/);
  83  | 
  84  |     await page.getByRole("button", { name: /find oldest pallets/i }).click();
  85  |     await expect(page.getByText(/covered:/i)).toBeVisible({ timeout: 5_000 });
  86  |   });
  87  | 
  88  |   test("aging report shows totals, per-zone breakdown, and oldest pallets", async ({ page }) => {
  89  |     await login(page);
  90  |     await page.goto("/inventory");
  91  |     await page.getByRole("button", { name: /^Warehouse$/ }).click();
  92  |     await expect(page.getByText(/main branch warehouse/i).first()).toBeVisible({ timeout: 10_000 });
  93  | 
  94  |     await page.getByRole("button", { name: /^Report/ }).click();
  95  |     await expect(page.getByRole("heading", { name: /aging report/i })).toBeVisible();
  96  |     // The four total tiles
  97  |     await expect(page.getByText(/Top 5 oldest/i)).toBeVisible({ timeout: 5_000 });
  98  |   });
  99  | 
  100 |   test("heatmap toggle changes its own active state", async ({ page }) => {
  101 |     await login(page);
  102 |     await page.goto("/inventory");
  103 |     await page.getByRole("button", { name: /^Warehouse$/ }).click();
  104 |     await expect(page.getByText(/main branch warehouse/i).first()).toBeVisible({ timeout: 10_000 });
  105 | 
  106 |     const heatmap = page.getByRole("button", { name: /^Heatmap/ });
  107 |     await expect(heatmap).toBeVisible();
  108 |     await heatmap.click();
  109 |     // Click again to ensure no error
  110 |     await heatmap.click();
  111 |   });
  112 | 
  113 |   test("customer filter dropdown lists seeded clients with colors", async ({ page }) => {
  114 |     await login(page);
  115 |     await page.goto("/inventory");
  116 |     await page.getByRole("button", { name: /^Warehouse$/ }).click();
  117 |     await expect(page.getByText(/main branch warehouse/i).first()).toBeVisible({ timeout: 10_000 });
  118 | 
  119 |     await page.getByRole("button", { name: /All customers|selected/ }).click();
  120 |     // Seeded clients from seed_demo_pallets.py
  121 |     await expect(page.getByRole("button", { name: /Juan Cruz Farms/ })).toBeVisible({ timeout: 5_000 });
  122 |     await expect(page.getByRole("button", { name: /Mill stock/ })).toBeVisible();
  123 | 
```