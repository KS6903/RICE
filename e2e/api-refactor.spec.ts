import { test, expect, request, type APIRequestContext } from "@playwright/test";

/**
 * End-to-end API checks for the OOP-refactored domains (paddy, inventory,
 * activity). These hit the REAL running backend over HTTP with a real login and
 * the seeded tenant, so they verify the layered refactor (schemas → repositories
 * → services → thin controllers) preserves the live HTTP contract end-to-end.
 *
 * Requires the backend running (uvicorn on :8000) and the seed tenant. Override
 * the base URL with E2E_API_BASE if the backend runs elsewhere.
 */
const BACKEND = process.env.E2E_API_BASE || "http://localhost:8001";
const TENANT = { username: "mill1", password: "password123" };

test.describe("Refactored API contract (paddy / inventory / activity)", () => {
  let api: APIRequestContext;
  let token: string;

  test.beforeAll(async () => {
    api = await request.newContext({
      baseURL: BACKEND,
      extraHTTPHeaders: { "X-Client-Type": "bearer" },
    });
    // OAuth2 password flow: form-encoded username/password.
    const res = await api.post("/api/auth/login", {
      form: { username: TENANT.username, password: TENANT.password },
    });
    expect(res.ok(), `login failed (${res.status()})`).toBeTruthy();
    token = (await res.json()).access_token;
    expect(token).toBeTruthy();
  });

  test.afterAll(async () => {
    await api.dispose();
  });

  const auth = () => ({ Authorization: `Bearer ${token}` });

  test("GET /api/paddy/varieties returns variety rows with the expected fields", async () => {
    const res = await api.get("/api/paddy/varieties", { headers: auth() });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBeTruthy();
    for (const v of body) {
      expect(v).toHaveProperty("code");
      expect(v).toHaveProperty("name");
      expect(v).toHaveProperty("is_active");
    }
  });

  // Codes must fit rice_varieties.code VARCHAR(20); keep them short.
  test("POST then GET a variety round-trips through the service layer", async () => {
    const code = `E2E${Date.now() % 1_000_000}`;
    const created = await api.post("/api/paddy/varieties", {
      headers: auth(),
      data: { code, name: "E2E Variety" },
    });
    expect(created.status()).toBe(201);
    expect((await created.json()).code).toBe(code);

    const listed = await api.get("/api/paddy/varieties", { headers: auth() });
    const codes = (await listed.json()).map((v: { code: string }) => v.code);
    expect(codes).toContain(code);
  });

  test("duplicate variety code is rejected with 409 + detail", async () => {
    const code = `DUP${Date.now() % 1_000_000}`;
    const first = await api.post("/api/paddy/varieties", { headers: auth(), data: { code, name: "Dup" } });
    expect(first.status()).toBe(201);
    const dup = await api.post("/api/paddy/varieties", { headers: auth(), data: { code, name: "Dup" } });
    expect(dup.status()).toBe(409);
    expect((await dup.json()).detail).toContain("already exists");
  });

  test("GET /api/paddy/inventory rows have the serialized shape", async () => {
    const res = await api.get("/api/paddy/inventory", { headers: auth() });
    expect(res.status()).toBe(200);
    const rows = await res.json();
    for (const r of rows) {
      expect(Object.keys(r).sort()).toEqual(
        ["branch", "branch_id", "grade", "id", "quantity_kg", "variety"].sort(),
      );
    }
  });

  test("GET /api/inventory/summary returns the totals envelope", async () => {
    const res = await api.get("/api/inventory/summary", { headers: auth() });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(
      ["by_branch", "byproducts", "milled_rice_total_kg", "palay_total_kg"].sort(),
    );
    expect(typeof body.palay_total_kg).toBe("number");
  });

  test("GET /api/inventory/milled-rice returns a list", async () => {
    const res = await api.get("/api/inventory/milled-rice", { headers: auth() });
    expect(res.status()).toBe(200);
    expect(Array.isArray(await res.json())).toBeTruthy();
  });

  test("GET /api/activity/ is reachable for an owner and returns audit rows", async () => {
    const res = await api.get("/api/activity/", { headers: auth() });
    expect(res.status()).toBe(200);
    const rows = await res.json();
    expect(Array.isArray(rows)).toBeTruthy();
    for (const r of rows) {
      expect(Object.keys(r).sort()).toEqual(
        ["action", "created_at", "detail", "entity_label", "entity_type", "id", "user_name"].sort(),
      );
    }
  });

  test("GET /api/milling/equipment returns a list", async () => {
    const res = await api.get("/api/milling/equipment", { headers: auth() });
    expect(res.status()).toBe(200);
    expect(Array.isArray(await res.json())).toBeTruthy();
  });

  test("POST /api/milling/equipment creates equipment", async () => {
    const res = await api.post("/api/milling/equipment", {
      headers: auth(),
      data: { name: `Mill ${Date.now() % 100000}` },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.name).toContain("Mill");
    expect(body.is_active).toBe(true);
  });

  test("GET /api/milling/batches returns a list", async () => {
    const res = await api.get("/api/milling/batches", { headers: auth() });
    expect(res.status()).toBe(200);
    expect(Array.isArray(await res.json())).toBeTruthy();
  });

  test("GET /api/costs/categories returns a list", async () => {
    const res = await api.get("/api/costs/categories", { headers: auth() });
    expect(res.status()).toBe(200);
    expect(Array.isArray(await res.json())).toBeTruthy();
  });

  test("POST /api/costs/categories creates a category", async () => {
    const res = await api.post("/api/costs/categories", {
      headers: auth(),
      data: { name: `Cat ${Date.now() % 100000}` },
    });
    expect(res.status()).toBe(201);
    expect((await res.json()).is_production_cost).toBe(true);
  });

  test("GET /api/costs/expenses returns a list", async () => {
    const res = await api.get("/api/costs/expenses", { headers: auth() });
    expect(res.status()).toBe(200);
    expect(Array.isArray(await res.json())).toBeTruthy();
  });

  test("GET /api/employees/ returns serialized employees", async () => {
    const res = await api.get("/api/employees/", { headers: auth() });
    expect(res.status()).toBe(200);
    const rows = await res.json();
    expect(Array.isArray(rows)).toBeTruthy();
    for (const e of rows) {
      expect(e).toHaveProperty("full_name");
      expect(e).toHaveProperty("is_active");
    }
  });

  test("POST /api/employees/ creates an employee with composed full_name", async () => {
    const res = await api.post("/api/employees/", {
      headers: auth(),
      data: { first_name: "E2E", last_name: `T${Date.now() % 100000}` },
    });
    expect(res.status()).toBe(201);
    expect((await res.json()).full_name).toContain("E2E");
  });

  test("GET /api/sales/customers returns a list", async () => {
    const res = await api.get("/api/sales/customers", { headers: auth() });
    expect(res.status()).toBe(200);
    expect(Array.isArray(await res.json())).toBeTruthy();
  });

  test("sales order -> invoice flow computes totals and advances status", async () => {
    const customer = await (
      await api.post("/api/sales/customers", { headers: auth(), data: { name: `Cust ${Date.now() % 100000}` } })
    ).json();

    const orderRes = await api.post("/api/sales/orders", {
      headers: auth(),
      data: {
        customer_id: customer.id,
        order_date: "2026-06-05",
        discount_pct: "10",
        items: [{ item_type: "milled_rice", quantity_kg: "100", unit_price_per_kg: "50" }],
      },
    });
    expect(orderRes.status()).toBe(201);
    const order = await orderRes.json();
    expect(order.order_no).toMatch(/^SO-\d{8}-\d{4}$/);
    expect(Number(order.total_amount)).toBe(4500); // 5000 - 10%

    const invRes = await api.post("/api/sales/invoices", {
      headers: auth(),
      data: { order_id: order.id, invoice_date: "2026-06-05" },
    });
    expect(invRes.status()).toBe(201);
    const inv = await invRes.json();
    expect(inv.invoice_no).toMatch(/^INV-\d{8}-\d{4}$/);
    expect(Number(inv.total_amount)).toBe(4500);
  });

  test("GET /api/branches/ returns live branches incl. a main branch", async () => {
    const res = await api.get("/api/branches/", { headers: auth() });
    expect(res.status()).toBe(200);
    const rows = await res.json();
    expect(Array.isArray(rows)).toBeTruthy();
    expect(rows.some((b: { is_main_branch: boolean }) => b.is_main_branch)).toBeTruthy();
  });

  test("GET /api/branches/company returns the company", async () => {
    const res = await api.get("/api/branches/company", { headers: auth() });
    expect(res.status()).toBe(200);
    expect(await res.json()).toHaveProperty("name");
  });

  test("saved locations: create then list round-trips with serialized shape", async () => {
    const created = await api.post("/api/locations", {
      headers: auth(),
      data: { label: `E2E Place ${Date.now() % 100000}`, lat: 14.6, lon: 121.0 },
    });
    expect(created.status()).toBe(201);
    const loc = await created.json();
    expect(Object.keys(loc).sort()).toEqual(
      ["country", "created_at", "id", "is_default", "label", "lat", "lon", "region"].sort(),
    );

    const list = await api.get("/api/locations", { headers: auth() });
    expect(list.status()).toBe(200);
    expect((await list.json()).some((r: { id: string }) => r.id === loc.id)).toBeTruthy();
  });

  test("GET /api/users/ returns the company's users", async () => {
    const res = await api.get("/api/users/", { headers: auth() });
    expect(res.status()).toBe(200);
    expect(Array.isArray(await res.json())).toBeTruthy();
  });

  test("GET /api/reports/pnl returns the P&L envelope", async () => {
    const res = await api.get("/api/reports/pnl", {
      headers: auth(),
      params: { period_start: "2026-01-01", period_end: "2026-12-31" },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    for (const k of ["revenue", "cost_of_goods", "gross_profit", "net_profit"]) {
      expect(body).toHaveProperty(k);
    }
  });

  test("offline sync: push then pull round-trips a record", async () => {
    const recordId = crypto.randomUUID();
    const push = await api.post("/api/sync/push", {
      headers: auth(),
      data: {
        client_id: "e2e",
        records: [
          {
            table_name: "paddy",
            record_id: recordId,
            operation: "INSERT",
            payload: { x: 1 },
            updated_at: "2026-06-05T00:00:00Z",
          },
        ],
      },
    });
    expect(push.status()).toBe(200);
    expect((await push.json()).synced).toBe(1);

    const pull = await api.get("/api/sync/pull", {
      headers: auth(),
      params: { since: "2020-01-01T00:00:00Z" },
    });
    expect(pull.status()).toBe(200);
    const body = await pull.json();
    expect(body).toHaveProperty("server_time");
    expect(body.records.some((r: { record_id: string }) => r.record_id === recordId)).toBeTruthy();
  });

  test("GET /api/sync/conflicts returns a list", async () => {
    const res = await api.get("/api/sync/conflicts", { headers: auth() });
    expect(res.status()).toBe(200);
    expect(Array.isArray(await res.json())).toBeTruthy();
  });

  test("GET /api/agents returns a list and POST creates one with a color", async () => {
    const list = await api.get("/api/agents", { headers: auth() });
    expect(list.status()).toBe(200);
    expect(Array.isArray(await list.json())).toBeTruthy();

    const created = await api.post("/api/agents", {
      headers: auth(),
      data: { name: `Agent ${Date.now() % 100000}` },
    });
    expect(created.status()).toBe(201);
    expect((await created.json()).canva_color_hex).toBeTruthy();
  });

  test("GET /api/dispatch/palette returns palette + in_use", async () => {
    const res = await api.get("/api/dispatch/palette", { headers: auth() });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.palette)).toBeTruthy();
    expect(Array.isArray(body.in_use)).toBeTruthy();
  });

  test("GET /api/dispatch/orders returns a list", async () => {
    const res = await api.get("/api/dispatch/orders", { headers: auth() });
    expect(res.status()).toBe(200);
    expect(Array.isArray(await res.json())).toBeTruthy();
  });

  test("GET /api/weather (explicit coords) returns the normalized schema", async () => {
    const res = await api.get("/api/weather", { headers: auth(), params: { lat: 14.6, lon: 121.0 } });
    expect(res.status()).toBe(200);
    const body = await res.json();
    for (const k of ["provider", "temp_c", "condition", "condition_code", "location", "fetched_at"]) {
      expect(body).toHaveProperty(k);
    }
  });

  test("GET /api/billing/plans returns active plans", async () => {
    const res = await api.get("/api/billing/plans", { headers: auth() });
    expect(res.status()).toBe(200);
    const rows = await res.json();
    expect(Array.isArray(rows)).toBeTruthy();
    for (const p of rows) {
      expect(p).toHaveProperty("code");
      expect(p).toHaveProperty("features");
    }
  });

  test("GET /api/billing/subscription + /upgrade-requests/mine respond", async () => {
    const sub = await api.get("/api/billing/subscription", { headers: auth() });
    expect(sub.status()).toBe(200);
    expect(await sub.json()).toHaveProperty("subscription");

    const mine = await api.get("/api/billing/upgrade-requests/mine", { headers: auth() });
    expect(mine.status()).toBe(200);
    expect(await mine.json()).toHaveProperty("request");
  });

  test("GET /api/auth/me returns the profile with features + subscription", async () => {
    const res = await api.get("/api/auth/me", { headers: auth() });
    expect(res.status()).toBe(200);
    const body = await res.json();
    for (const k of ["username", "role", "features", "subscription", "is_platform_admin"]) {
      expect(body).toHaveProperty(k);
    }
  });

  test("auth refresh issues a fresh access token", async () => {
    const login = await api.post("/api/auth/login", {
      form: { username: TENANT.username, password: TENANT.password },
    });
    const { refresh_token } = await login.json();
    const res = await api.post("/api/auth/refresh", { data: { refresh_token } });
    expect(res.status()).toBe(200);
    expect((await res.json()).access_token).toBeTruthy();
  });

  test("admin endpoints reject a non-platform-admin (403)", async () => {
    // mill1 is a tenant owner, not a platform admin.
    const res = await api.get("/api/admin/stats", { headers: auth() });
    expect(res.status()).toBe(403);
  });

  test("platform admin can read stats / plans / tenants", async () => {
    const login = await api.post("/api/auth/login", {
      form: { username: "admin", password: "admin1234" },
    });
    expect(login.status(), "seed platform-admin account should exist").toBe(200);
    const ah = { Authorization: `Bearer ${(await login.json()).access_token}` };

    const stats = await api.get("/api/admin/stats", { headers: ah });
    expect(stats.status()).toBe(200);
    expect(await stats.json()).toHaveProperty("total_tenants");

    expect((await api.get("/api/admin/plans", { headers: ah })).status()).toBe(200);
    expect((await api.get("/api/admin/tenants", { headers: ah })).status()).toBe(200);
  });

  test("feature/auth gate: a request without a token is rejected", async () => {
    // Use a FRESH context: the describe's login populated `api`'s cookie jar with
    // the httpOnly session cookie, and the API now accepts cookie auth in addition
    // to bearer tokens — so `api` (logged in) would carry one. A clean context
    // sends no credentials at all, which is the actual "anonymous" case.
    const anon = await request.newContext({ baseURL: BACKEND });
    const res = await anon.get("/api/paddy/varieties");
    expect(res.status()).toBe(401);
    await anon.dispose();
  });
});
