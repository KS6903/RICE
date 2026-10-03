import { describe, expect, it } from "vitest";
import { parsePullResponse, SyncIdentity } from "../main/sync/contract";

const identity: SyncIdentity = {
  userId: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  companyId: "9b2b1c3e-1d2f-4a5b-8c6d-7e8f9a0b1c2d",
  schema: "client_abc",
  role: "owner",
};

function purchase(id: string, overrides: Record<string, unknown> = {}) {
  return {
    table_name: "palay_purchases",
    record_id: id,
    operation: "INSERT",
    payload: {
      id,
      company_id: identity.companyId,
      reference_no: "PP-1",
      purchase_date: "2026-10-01",
      ...overrides,
    },
    synced_at: "2026-10-01T00:00:00Z",
  };
}

const GOOD = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const ALSO_GOOD = "3f2504e0-4f89-41d3-9a0c-0305e82c3303";
const BAD = "3f2504e0-4f89-41d3-9a0c-0305e82c3302";

describe("parsePullResponse", () => {
  it("sets aside a bad record and keeps the rest of the page", () => {
    const page = parsePullResponse(
      {
        records: [purchase(GOOD), purchase(BAD, { unknown_column: 1 }), purchase(ALSO_GOOD)],
        server_time: "2026-10-01T00:00:01Z",
        has_more: false,
      },
      identity,
    );
    expect(page.records.map((r) => r.record_id)).toEqual([GOOD, ALSO_GOOD]);
    expect(page.rejected).toEqual([
      {
        table: "palay_purchases",
        recordId: BAD,
        reason: "Unsupported sync field for palay_purchases",
      },
    ]);
  });

  it("keeps nothing of another tenant's record but that it was refused", () => {
    const page = parsePullResponse(
      {
        records: [
          purchase(BAD, { company_id: "11111111-1111-4111-8111-111111111111", remarks: "theirs" }),
        ],
        server_time: "2026-10-01T00:00:01Z",
        has_more: false,
      },
      identity,
    );
    expect(page.records).toEqual([]);
    expect(page.rejected).toEqual([
      { table: "palay_purchases", recordId: BAD, reason: "Cross-tenant sync record rejected" },
    ]);
    expect(JSON.stringify(page)).not.toContain("theirs");
  });

  it("names nothing it can't trust", () => {
    const page = parsePullResponse(
      {
        records: [{ table_name: "users; DROP TABLE x", record_id: "not-a-uuid" }],
        server_time: "2026-10-01T00:00:01Z",
        has_more: false,
      },
      identity,
    );
    expect(page.rejected).toEqual([
      { table: "unknown", recordId: "unknown", reason: "Invalid sync table" },
    ]);
  });

  it("still refuses a page that is itself malformed", () => {
    expect(() =>
      parsePullResponse({ records: "nope", server_time: "x", has_more: false }, identity),
    ).toThrow();
    expect(() =>
      parsePullResponse(
        { records: [], server_time: "2026-10-01T00:00:01", has_more: false },
        identity,
      ),
    ).toThrow(/server_time/);
  });
});
