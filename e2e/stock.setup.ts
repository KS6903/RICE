import { test as setup, expect } from "@playwright/test";
import { apiToken, bearer } from "./support/session";

/**
 * The disposable database starts with an empty mill. Before the browser tests
 * run, buy one delivery of palay and mill part of it, through the same API the
 * app uses, so there is palay, milled rice and by-products in stock.
 *
 * This also fixes the getting-started checklist at a known point: the palay
 * and milling steps are done; sales, expenses and staff are not. Tests that
 * read the checklist (first-run.spec.ts) rely on no test before them selling,
 * logging an expense or adding a user.
 */
setup("record a palay purchase and a milling batch", async ({ request }) => {
  const headers = bearer(await apiToken(request));
  const today = new Date().toISOString().slice(0, 10);

  // Each new mill gets its own variety and grade catalog when it's provisioned.
  const varieties = await (await request.get("/api/paddy/varieties", { headers })).json();
  const grades = await (await request.get("/api/paddy/grades", { headers })).json();
  expect(varieties.length, "the new mill has no rice varieties").toBeGreaterThan(0);
  expect(grades.length, "the new mill has no quality grades").toBeGreaterThan(0);
  const variety_id = varieties[0].id;
  const grade_id = grades[0].id;

  const purchase = await request.post("/api/paddy/purchases", {
    headers,
    data: {
      purchase_date: today,
      delivery_type: "delivered",
      remarks: "E2E seed",
      items: [
        {
          variety_id,
          grade_id,
          gross_weight_kg: 5050,
          tare_weight_kg: 50,
          moisture_content_pct: 14,
          price_per_cavan: 1200,
        },
      ],
    },
  });
  expect(purchase.ok(), `purchase failed (${purchase.status()})`).toBeTruthy();

  const machine = await request.post("/api/milling/equipment", {
    headers,
    data: { name: "E2E Huller", capacity_kg_per_hr: 500 },
  });
  expect(machine.ok(), `equipment failed (${machine.status()})`).toBeTruthy();

  const batch = await request.post("/api/milling/batches", {
    headers,
    data: {
      equipment_id: (await machine.json()).id,
      start_datetime: new Date().toISOString(),
      remarks: "E2E seed",
      inputs: [{ variety_id, grade_id, input_weight_kg: 2000, moisture_content_pct: 14 }],
      outputs: [
        {
          output_type: "milled_rice",
          variety_id,
          output_weight_kg: 1300,
          broken_rice_pct: 5,
          grade_name: "regular",
        },
        { output_type: "ipa", variety_id, output_weight_kg: 400 },
        { output_type: "darak", variety_id, output_weight_kg: 200 },
      ],
    },
  });
  expect(batch.ok(), `milling batch failed (${batch.status()})`).toBeTruthy();
});
