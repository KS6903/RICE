// The desktop app's SQLite: Node's own (node:sqlite), built into Electron.
//
// It replaces better-sqlite3, a native module that had to match each Electron
// release's ABI, and whose v13 made `npm ci` compile it (npm/cli#9837): no
// Visual Studio, no install. node:sqlite ships with the runtime, so there is
// nothing to build, rebuild or download.
//
// What better-sqlite3 gave that node:sqlite doesn't, kept here: a pragma
// helper, and transactions that nest (an inner one becomes a savepoint).
import { DatabaseSync, StatementSync, type SQLInputValue } from "node:sqlite";

export type Db = DatabaseSync;
export type Statement = StatementSync;

export function openDatabase(file: string, { readOnly = false } = {}): Db {
  // Read-only never creates the file, so a missing one fails to open.
  return new DatabaseSync(file, { readOnly });
}

/** Run a PRAGMA and return its first value (or undefined when it has none). */
export function pragma(db: Db, statement: string): unknown {
  const row = db.prepare(`PRAGMA ${statement}`).get() as Record<string, unknown> | undefined;
  return row ? Object.values(row)[0] : undefined;
}

const depth = new WeakMap<Db, number>();

/**
 * Run `work` in a transaction: committed if it returns, rolled back if it
 * throws (and the error rethrown). Called inside another, it's a savepoint, so
 * an inner failure undoes only the inner work.
 */
export function transaction<T>(db: Db, work: () => T): T {
  const level = depth.get(db) ?? 0;
  const savepoint = `sp_${level}`;
  db.exec(level === 0 ? "BEGIN" : `SAVEPOINT ${savepoint}`);
  depth.set(db, level + 1);
  try {
    const result = work();
    db.exec(level === 0 ? "COMMIT" : `RELEASE ${savepoint}`);
    return result;
  } catch (error) {
    db.exec(level === 0 ? "ROLLBACK" : `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`);
    throw error;
  } finally {
    depth.set(db, level);
  }
}

/** A value SQLite can store. Booleans become 1 and 0, as SQLite keeps them. */
export function sqlValue(value: unknown): SQLInputValue {
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value === undefined) return null;
  return value as SQLInputValue;
}
