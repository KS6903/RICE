import { beforeEach, describe, expect, it } from "vitest";
import { Db, openDatabase, pragma, sqlValue, transaction } from "../main/database/db";
import {
  QUARANTINED,
  createQuarantineTable,
  quarantineCount,
  quarantinePull,
  quarantinePush,
  retryAfterUpdate,
} from "../main/sync/quarantine";

let db: Db;

beforeEach(() => {
  db = openDatabase(":memory:");
  db.exec("CREATE TABLE payments (id TEXT PRIMARY KEY, amount REAL, _synced INTEGER DEFAULT 0)");
  createQuarantineTable(db);
});

const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n;

describe("transaction", () => {
  it("commits what succeeds", () => {
    transaction(db, () => db.prepare("INSERT INTO payments (id) VALUES ('a')").run());
    expect(count("SELECT COUNT(*) n FROM payments")).toBe(1);
  });

  it("rolls back what throws, and rethrows", () => {
    expect(() =>
      transaction(db, () => {
        db.prepare("INSERT INTO payments (id) VALUES ('a')").run();
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(count("SELECT COUNT(*) n FROM payments")).toBe(0);
  });

  it("undoes only a failing inner one, as sync does per pulled record", () => {
    transaction(db, () => {
      db.prepare("INSERT INTO payments (id) VALUES ('kept')").run();
      expect(() =>
        transaction(db, () => {
          db.prepare("INSERT INTO payments (id) VALUES ('undone')").run();
          db.prepare("INSERT INTO payments (id) VALUES ('kept')").run(); // duplicate key
        }),
      ).toThrow();
      db.prepare("INSERT INTO payments (id) VALUES ('also-kept')").run();
    });
    const ids = (
      db.prepare("SELECT id FROM payments ORDER BY id").all() as Array<{ id: string }>
    ).map((row) => row.id);
    expect(ids).toEqual(["also-kept", "kept"]);
  });

  it("can start again after one fails", () => {
    expect(() => transaction(db, () => db.exec("NOT SQL"))).toThrow();
    transaction(db, () => db.prepare("INSERT INTO payments (id) VALUES ('a')").run());
    expect(count("SELECT COUNT(*) n FROM payments")).toBe(1);
  });
});

describe("pragma and values", () => {
  it("returns a pragma's value", () => {
    pragma(db, "foreign_keys = ON");
    expect(pragma(db, "foreign_keys")).toBe(1);
    expect(pragma(db, "quick_check")).toBe("ok");
  });

  it("stores booleans as SQLite does", () => {
    // The sync contract allows booleans; SQLite bindings refuse them as is.
    db.exec("CREATE TABLE flags (v INTEGER)");
    db.prepare("INSERT INTO flags VALUES (?), (?), (?)").run(
      sqlValue(true),
      sqlValue(false),
      sqlValue(undefined),
    );
    expect(
      db
        .prepare("SELECT v FROM flags")
        .all()
        .map((row) => row.v),
    ).toEqual([1, 0, null]);
  });
});

describe("the sync quarantine", () => {
  it("sets a refused row aside and notes why", () => {
    db.prepare("INSERT INTO payments (id, amount) VALUES ('p1', 10)").run();
    quarantinePush(db, "payments", "p1", "422: missing invoice", "1.0.0");
    expect(count(`SELECT COUNT(*) n FROM payments WHERE _synced = ${QUARANTINED}`)).toBe(1);
    expect(quarantineCount(db)).toBe(1);
  });

  it("retries after an update: rows go back in the queue, the pull rewinds", () => {
    db.prepare("INSERT INTO payments (id) VALUES ('p1')").run();
    quarantinePush(db, "payments", "p1", "refused", "1.0.0");
    quarantinePull(
      db,
      "payments",
      "p2",
      "update before insert",
      "1.0.0",
      "2026-10-01T08:00:00.000Z",
    );
    quarantinePull(db, "payments", "p3", "malformed", "1.0.0", null);

    expect(retryAfterUpdate(db, "1.0.0")).toBeNull(); // same version: nothing to retry
    const rewind = retryAfterUpdate(db, "1.1.0");
    expect(rewind).toBe("2026-10-01T07:59:59.999Z");
    expect(count("SELECT COUNT(*) n FROM payments WHERE _synced = 0")).toBe(1);
    expect(quarantineCount(db)).toBe(0);
  });
});
