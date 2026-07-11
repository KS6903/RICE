import { ipcMain, IpcMainInvokeEvent } from "electron";
import { TenantDatabaseManager } from "../database/sqlite";

export type IpcAuthorizer = (event: IpcMainInvokeEvent) => void;

const PADDY_READ_ROLES = new Set(["owner", "admin", "accountant", "mill_operator", "encoder"]);
const MILLING_READ_ROLES = new Set(["owner", "admin", "accountant", "mill_operator", "encoder"]);

function authorizeRole(dbManager: TenantDatabaseManager, roles: ReadonlySet<string>): void {
  const role = dbManager.getIdentity()?.role;
  if (!role || !roles.has(role)) throw new Error("Local data access denied");
}

export function registerIpcHandlers(
  dbManager: TenantDatabaseManager,
  authorize: IpcAuthorizer,
): void {
  // A generic SQL bridge is deliberately absent. Every handler validates that
  // it came from the app's top-level frame, then executes only fixed SQL.

  ipcMain.handle("db:isSetup", (event) => {
    authorize(event);
    const db = dbManager.getDatabase();
    if (!db) return false;
    const row = db.prepare("SELECT id FROM companies LIMIT 1").get();
    return Boolean(row);
  });

  ipcMain.handle("palay:getPurchases", (event) => {
    authorize(event);
    authorizeRole(dbManager, PADDY_READ_ROLES);
    const db = dbManager.requireDatabase();
    return db
      .prepare(
        `
      SELECT pp.*, s.name as supplier_name
      FROM palay_purchases pp
      LEFT JOIN suppliers s ON s.id = pp.supplier_id
      ORDER BY pp.purchase_date DESC
      LIMIT 100
    `,
      )
      .all();
  });

  ipcMain.handle("milling:getBatches", (event) => {
    authorize(event);
    authorizeRole(dbManager, MILLING_READ_ROLES);
    const db = dbManager.requireDatabase();
    return db
      .prepare(
        `
      SELECT mb.*
      FROM milling_batches mb
      ORDER BY mb.start_datetime DESC
      LIMIT 100
    `,
      )
      .all();
  });

  ipcMain.handle("inventory:getSummary", (event) => {
    authorize(event);
    const db = dbManager.requireDatabase();
    const palayKg = db.prepare("SELECT SUM(quantity_kg) as total FROM palay_inventory").get() as {
      total: number | null;
    };
    const milledKg = db
      .prepare("SELECT SUM(quantity_kg) as total FROM milled_rice_inventory")
      .get() as { total: number | null };
    const byproducts = db
      .prepare(
        "SELECT byproduct_type, SUM(quantity_kg) as kg FROM byproduct_inventory GROUP BY byproduct_type",
      )
      .all() as Array<{ byproduct_type: string; kg: number }>;
    return {
      palay_total_kg: palayKg?.total ?? 0,
      milled_rice_total_kg: milledKg?.total ?? 0,
      byproducts: Object.fromEntries(byproducts.map((item) => [item.byproduct_type, item.kg])),
    };
  });
}
