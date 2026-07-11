import axios from "axios";
import crypto from "crypto";
import Database from "better-sqlite3";
import { net } from "electron";
import { TenantDatabaseManager } from "../database/sqlite";
import {
  assertValidRecord,
  parsePullResponse,
  payloadFromLocalRow,
  SyncIdentity,
  SyncRecord,
  SYNC_TABLES,
  SyncTable,
  TABLE_COLUMNS,
} from "./contract";

const PUSH_BATCH_SIZE = 100;
const MAX_PULL_PAGES_PER_RUN = 20;

interface QueuedRecord {
  table: SyncTable;
  id: string;
  record: SyncRecord;
}

interface SyncContext {
  version: number;
  token: string;
  identity: SyncIdentity;
  db: Database.Database;
}

export class SyncEngine {
  private intervalId: NodeJS.Timeout | null = null;
  private accessToken = "";
  private identity: SyncIdentity | null = null;
  private syncInFlight: Promise<void> | null = null;
  private sessionVersion = 0;

  constructor(
    private readonly dbManager: TenantDatabaseManager,
    private readonly apiBase = "http://localhost:8000/api",
    private readonly onSessionInvalidated: () => void = () => {},
  ) {
    this.startMonitoring();
  }

  setSession(token: string, identity: SyncIdentity): void {
    this.sessionVersion += 1;
    this.dbManager.activate(identity);
    this.accessToken = token;
    this.identity = { ...identity };
  }

  clearSession(): void {
    this.sessionVersion += 1;
    this.accessToken = "";
    this.identity = null;
    this.dbManager.clear();
  }

  private startMonitoring(): void {
    this.intervalId = setInterval(() => {
      if (net.isOnline()) void this.sync();
    }, 30_000);
  }

  stop(): void {
    if (this.intervalId) clearInterval(this.intervalId);
    this.intervalId = null;
    this.clearSession();
  }

  sync(): Promise<void> {
    if (this.syncInFlight) return this.syncInFlight;
    this.syncInFlight = this.runSync().finally(() => {
      this.syncInFlight = null;
    });
    return this.syncInFlight;
  }

  private async runSync(): Promise<void> {
    const context = this.captureContext();
    if (!context) return;
    try {
      await this.push(context);
      this.assertCurrent(context);
      await this.pull(context);
    } catch (error) {
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      // A 401 means the persisted access token expired or was revoked. Drop both
      // the credential and active DB handle; never keep serving stale local data
      // under a logged-out session.
      if (status === 401 && this.isCurrent(context)) {
        this.clearSession();
        this.onSessionInvalidated();
      }
      this.logSafeFailure(error);
    }
  }

  private async push(context: SyncContext): Promise<void> {
    const { db, identity } = context;
    const records: QueuedRecord[] = [];

    for (const table of SYNC_TABLES) {
      const remaining = PUSH_BATCH_SIZE - records.length;
      if (remaining <= 0) break;
      // `table` comes only from the compile-time SYNC_TABLES tuple.
      const rows = db
        .prepare(`SELECT * FROM ${table} WHERE _synced = 0 LIMIT ?`)
        .all(remaining) as Array<Record<string, unknown>>;
      for (const row of rows) {
        const payload = payloadFromLocalRow(table, row);
        if (Object.hasOwn(payload, "company_id")) payload.company_id = identity.companyId;
        if (Object.hasOwn(payload, "created_by")) payload.created_by = identity.userId;
        if (Object.hasOwn(payload, "received_by")) payload.received_by = identity.userId;
        const id = payload.id;
        if (typeof id !== "string") throw new Error("Local sync row has no valid id");
        const record = assertValidRecord(
          {
            table_name: table,
            record_id: id,
            operation: "INSERT",
            payload,
            updated_at: new Date().toISOString(),
          },
          identity,
        );
        records.push({ table, id, record });
      }
    }
    if (records.length === 0) return;

    const response = await axios.post(
      `${this.apiBase}/sync/push`,
      { client_id: this.getClientId(db), records: records.map((item) => item.record) },
      {
        headers: { Authorization: `Bearer ${context.token}` },
        timeout: 15_000,
        maxBodyLength: 512 * 1024,
        maxContentLength: 128 * 1024,
      },
    );
    if (
      typeof response.data !== "object" ||
      response.data === null ||
      response.data.synced !== records.length
    ) {
      throw new Error("Invalid sync push acknowledgement");
    }
    this.assertCurrent(context);

    const markSynced = new Map<SyncTable, Database.Statement>();
    const commit = db.transaction(() => {
      for (const item of records) {
        let statement = markSynced.get(item.table);
        if (!statement) {
          // Table identifiers are drawn from SYNC_TABLES, not HTTP/renderer data.
          statement = db.prepare(
            `UPDATE ${item.table} SET _synced = 1 WHERE id = ? AND _synced = 0`,
          );
          markSynced.set(item.table, statement);
        }
        statement.run(item.id);
      }
    });
    commit();
  }

  private async pull(context: SyncContext): Promise<void> {
    const { db, identity } = context;
    const cursorKey = `last_synced_at:${identity.role}`;
    let since = this.getLastSynced(db, cursorKey);

    for (let pageNumber = 0; pageNumber < MAX_PULL_PAGES_PER_RUN; pageNumber += 1) {
      this.assertCurrent(context);
      const response = await axios.get(`${this.apiBase}/sync/pull`, {
        params: { since },
        headers: { Authorization: `Bearer ${context.token}` },
        timeout: 15_000,
        maxContentLength: 2 * 1024 * 1024,
      });
      this.assertCurrent(context);
      const page = parsePullResponse(response.data, identity);

      // Replay and cursor advancement are one SQLite transaction. A malformed
      // row or constraint failure rolls back the entire page, so it is retried
      // rather than silently skipped.
      const applyPage = db.transaction(() => {
        for (const record of page.records) this.applyRecord(db, record);
        db.prepare(
          "INSERT INTO _local_sync_meta (key, value) VALUES (?, ?) " +
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        ).run(cursorKey, page.server_time);
      });
      applyPage();
      since = page.server_time;
      if (!page.has_more) break;
    }
  }

  private applyRecord(db: Database.Database, record: SyncRecord): void {
    const table = record.table_name;
    if (record.operation === "DELETE") {
      // Table is already a validated SyncTable; the record id remains bound.
      db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(record.record_id);
      return;
    }

    // Generate SQL identifiers only by filtering the static per-table column
    // list. Response keys merely decide membership; they are never interpolated.
    const cols = TABLE_COLUMNS[table].filter((column) => Object.hasOwn(record.payload, column));
    if (!cols.includes("id")) throw new Error("Sync payload is missing its id");
    const values = cols.map((column) => record.payload[column]);

    if (record.operation === "UPDATE") {
      const existing = db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(record.record_id);
      if (!existing) throw new Error("Cannot apply an update before its insert");
      const mutable = cols.filter((column) => column !== "id");
      if (mutable.length === 0) return;
      db.prepare(
        `UPDATE ${table} SET ${mutable.map((column) => `${column} = ?`).join(", ")}, _synced = 1 WHERE id = ?`,
      ).run(...mutable.map((column) => record.payload[column]), record.record_id);
      return;
    }

    const placeholders = cols.map(() => "?").join(", ");
    const mutable = cols.filter((column) => column !== "id");
    const conflict =
      mutable.length > 0
        ? `DO UPDATE SET ${mutable.map((column) => `${column} = excluded.${column}`).join(", ")}, _synced = 1`
        : "DO NOTHING";
    db.prepare(
      `INSERT INTO ${table} (${cols.join(", ")}, _synced) VALUES (${placeholders}, 1) ` +
        `ON CONFLICT(id) ${conflict}`,
    ).run(...values);
  }

  private getClientId(db: Database.Database): string {
    const row = db.prepare("SELECT value FROM _local_sync_meta WHERE key = 'device_id'").get() as
      | { value: string }
      | undefined;
    if (row?.value) return row.value;
    const id = `electron-${crypto.randomUUID()}`;
    db.prepare("INSERT INTO _local_sync_meta (key, value) VALUES ('device_id', ?)").run(id);
    return id;
  }

  private getLastSynced(db: Database.Database, cursorKey: string): string {
    const row = db.prepare("SELECT value FROM _local_sync_meta WHERE key = ?").get(cursorKey) as
      | { value: string }
      | undefined;
    return row?.value ?? new Date(0).toISOString();
  }

  private captureContext(): SyncContext | null {
    const db = this.dbManager.getDatabase();
    if (!this.accessToken || !this.identity || !db) return null;
    return {
      version: this.sessionVersion,
      token: this.accessToken,
      identity: { ...this.identity },
      db,
    };
  }

  private isCurrent(context: SyncContext): boolean {
    return (
      context.version === this.sessionVersion &&
      context.db === this.dbManager.getDatabase() &&
      context.token === this.accessToken &&
      this.identity !== null &&
      context.identity.userId === this.identity.userId &&
      context.identity.companyId === this.identity.companyId
    );
  }

  private assertCurrent(context: SyncContext): void {
    if (!this.isCurrent(context))
      throw new Error("Sync session changed while a request was in flight");
  }

  private logSafeFailure(error: unknown): void {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status ?? "network";
      const code =
        typeof error.code === "string" ? error.code.replace(/[^A-Z0-9_]/gi, "") : "AXIOS";
      // Never log Axios config/request/response objects: they contain the Bearer
      // token and may contain financial row payloads.
      console.error(`[SyncEngine] sync failed status=${status} code=${code}`);
      return;
    }
    console.error("[SyncEngine] sync failed validation_or_database_error");
  }
}
