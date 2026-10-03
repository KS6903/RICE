// Records sync set aside, so the rest keep moving.
//
// A local row the server refused stays in its table, marked _synced = 2, so
// it's neither lost nor retried every 30 seconds. A pulled record this device
// couldn't apply is noted without its payload (it may be malformed or another
// tenant's), and the pull cursor moves past it.
//
// A new app version is the likely fix for either, so after an update both are
// retried: refused rows go back in the queue, and the pull rewinds to the
// first record it skipped.
import Database from "better-sqlite3";
import { SYNC_TABLES, SyncTable } from "./contract";

export const QUARANTINED = 2;

export function createQuarantineTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _sync_quarantine (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      direction TEXT NOT NULL CHECK (direction IN ('push', 'pull')),
      table_name TEXT NOT NULL,
      record_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      synced_at TEXT,
      app_version TEXT NOT NULL,
      quarantined_at TEXT NOT NULL
    );
  `);
}

function note(
  db: Database.Database,
  direction: "push" | "pull",
  table: string,
  recordId: string,
  reason: string,
  appVersion: string,
  syncedAt: string | null = null,
): void {
  db.prepare(
    "INSERT INTO _sync_quarantine (direction, table_name, record_id, reason, synced_at, app_version, quarantined_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(
    direction,
    table,
    recordId,
    reason.slice(0, 500),
    syncedAt,
    appVersion,
    new Date().toISOString(),
  );
}

/** Set aside a local row the server refused (or that isn't valid to send). */
export function quarantinePush(
  db: Database.Database,
  table: SyncTable,
  recordId: string,
  reason: string,
  appVersion: string,
): void {
  db.transaction(() => {
    // `table` is a SyncTable from the compile-time list, never external input.
    db.prepare(`UPDATE ${table} SET _synced = ${QUARANTINED} WHERE id = ?`).run(recordId);
    note(db, "push", table, recordId, reason, appVersion);
  })();
}

/** Note a pulled record that couldn't be applied; the caller moves on. */
export function quarantinePull(
  db: Database.Database,
  table: string,
  recordId: string,
  reason: string,
  appVersion: string,
  syncedAt: string | null,
): void {
  note(db, "pull", table, recordId, reason, appVersion, syncedAt);
}

export function quarantineCount(db: Database.Database): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM _sync_quarantine").get() as { n: number }).n;
}

/**
 * After an update, retry what an older version set aside. Returns the pull
 * cursor to rewind to (just before the first skipped record), if any.
 */
export function retryAfterUpdate(db: Database.Database, appVersion: string): string | null {
  let rewindTo: string | null = null;
  db.transaction(() => {
    const older = db
      .prepare(
        "SELECT direction, table_name, record_id, synced_at FROM _sync_quarantine WHERE app_version <> ?",
      )
      .all(appVersion) as Array<{
      direction: string;
      table_name: string;
      record_id: string;
      synced_at: string | null;
    }>;
    for (const row of older) {
      const table = SYNC_TABLES.find((name) => name === row.table_name);
      if (row.direction === "push" && table) {
        db.prepare(`UPDATE ${table} SET _synced = 0 WHERE id = ? AND _synced = ${QUARANTINED}`).run(
          row.record_id,
        );
      } else if (row.direction === "pull" && row.synced_at) {
        const before = new Date(Date.parse(row.synced_at) - 1).toISOString();
        if (rewindTo === null || before < rewindTo) rewindTo = before;
      }
    }
    db.prepare("DELETE FROM _sync_quarantine WHERE app_version <> ?").run(appVersion);
  })();
  return rewindTo;
}
