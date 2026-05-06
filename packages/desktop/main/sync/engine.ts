import Database from "better-sqlite3";
import axios from "axios";
import { net } from "electron";

const SYNC_TABLES = [
  "palay_purchases", "palay_purchase_items", "palay_inventory",
  "milling_batches", "milling_batch_inputs", "milling_batch_outputs",
  "milled_rice_inventory", "byproduct_inventory",
  "sales_orders", "sales_order_items", "invoices", "payments", "expenses",
];

export class SyncEngine {
  private db: Database.Database;
  private intervalId: NodeJS.Timeout | null = null;
  private apiBase: string;
  private accessToken: string = "";

  constructor(db: Database.Database, apiBase = "http://localhost:8000/api") {
    this.db = db;
    this.apiBase = apiBase;
    this.startMonitoring();
  }

  setToken(token: string) { this.accessToken = token; }

  private startMonitoring() {
    this.intervalId = setInterval(() => {
      if (net.isOnline()) this.sync().catch(console.error);
    }, 30_000); // sync every 30s when online
  }

  stop() {
    if (this.intervalId) clearInterval(this.intervalId);
  }

  async sync() {
    if (!this.accessToken) return;
    try {
      await this.push();
      await this.pull();
    } catch (err) {
      console.error("[SyncEngine] Sync failed:", err);
    }
  }

  private async push() {
    const records: unknown[] = [];
    for (const table of SYNC_TABLES) {
      const unsynced = this.db.prepare(`SELECT * FROM ${table} WHERE _synced = 0`).all();
      for (const row of unsynced) {
        records.push({ table_name: table, record_id: (row as any).id, operation: "INSERT", payload: row, updated_at: new Date().toISOString() });
      }
    }
    if (records.length === 0) return;

    const clientId = this.getClientId();
    await axios.post(`${this.apiBase}/sync/push`, { client_id: clientId, records }, { headers: { Authorization: `Bearer ${this.accessToken}` } });

    for (const table of SYNC_TABLES) {
      this.db.prepare(`UPDATE ${table} SET _synced = 1 WHERE _synced = 0`).run();
    }
    console.log(`[SyncEngine] Pushed ${records.length} records`);
  }

  private async pull() {
    const lastSynced = this.getLastSynced();
    const { data } = await axios.get(`${this.apiBase}/sync/pull`, {
      params: { since: lastSynced },
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });

    for (const record of data.records) {
      this.applyRecord(record);
    }

    if (data.server_time) {
      this.db.prepare("INSERT OR REPLACE INTO _local_sync_meta (key, value) VALUES ('last_synced_at', ?)").run(data.server_time);
    }
    console.log(`[SyncEngine] Pulled ${data.records.length} records`);
  }

  private applyRecord(record: { table_name: string; record_id: string; operation: string; payload: Record<string, unknown> }) {
    const { table_name, operation, payload } = record;
    if (!SYNC_TABLES.includes(table_name)) return;

    if (operation === "DELETE") {
      this.db.prepare(`DELETE FROM ${table_name} WHERE id = ?`).run(record.record_id);
      return;
    }

    const cols = Object.keys(payload).filter(k => k !== "_synced");
    const placeholders = cols.map(() => "?").join(", ");
    const values = cols.map(c => payload[c]);

    this.db.prepare(`INSERT OR REPLACE INTO ${table_name} (${cols.join(", ")}, _synced) VALUES (${placeholders}, 1)`).run(...values);
  }

  private getClientId(): string {
    let id = this.db.prepare("SELECT value FROM _local_sync_meta WHERE key = 'device_id'").get() as { value: string } | undefined;
    if (!id) {
      const newId = `electron-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      this.db.prepare("INSERT INTO _local_sync_meta (key, value) VALUES ('device_id', ?)").run(newId);
      return newId;
    }
    return id.value;
  }

  private getLastSynced(): string {
    const row = this.db.prepare("SELECT value FROM _local_sync_meta WHERE key = 'last_synced_at'").get() as { value: string } | undefined;
    return row?.value || new Date(0).toISOString();
  }
}
