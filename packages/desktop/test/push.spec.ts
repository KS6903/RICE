import { AxiosError, AxiosHeaders } from "axios";
import { describe, expect, it } from "vitest";
import { pushIsolating, recordRejection } from "../main/sync/push";

function httpError(
  status: number,
  detail: unknown,
  headers: Record<string, string> = {},
): AxiosError {
  const error = new AxiosError("request failed");
  error.response = {
    status,
    statusText: "",
    data: { detail },
    headers,
    config: { headers: new AxiosHeaders() },
  };
  return error;
}

describe("recordRejection", () => {
  it("treats invalid content as one record's problem", () => {
    expect(recordRejection(httpError(422, "Missing INSERT fields"))).toBe(
      "422: Missing INSERT fields",
    );
    expect(recordRejection(httpError(413, "Sync record payload is too large"))).toMatch(/^413/);
    expect(
      recordRejection(
        httpError(403, "Sync is limited to your assigned branch", { "x-sync-rejection": "record" }),
      ),
    ).toMatch(/assigned branch/);
  });

  it("stops for anything about the account, the session or the server", () => {
    expect(
      recordRejection(httpError(403, "Offline sync is not available for this account")),
    ).toBeNull();
    expect(recordRejection(httpError(402, "plan"))).toBeNull();
    expect(recordRejection(httpError(401, "expired"))).toBeNull();
    expect(recordRejection(httpError(426, "update"))).toBeNull();
    expect(recordRejection(httpError(500, "boom"))).toBeNull();
    expect(recordRejection(new AxiosError("offline"))).toBeNull();
    expect(recordRejection(new Error("not http"))).toBeNull();
  });
});

describe("pushIsolating", () => {
  /** A server that refuses any batch containing a bad record. */
  function server(bad: Set<number>) {
    const calls: number[][] = [];
    const synced: number[] = [];
    const rejected: number[] = [];
    const run = (items: number[]) =>
      pushIsolating(items, {
        send: async (batch) => {
          calls.push(batch);
          const culprit = batch.find((item) => bad.has(item));
          if (culprit !== undefined) throw httpError(422, `record ${culprit} is invalid`);
        },
        rejection: recordRejection,
        onSynced: (batch) => synced.push(...batch),
        onRejected: (item) => rejected.push(item),
      });
    return { run, calls, synced, rejected };
  }

  it("sends a clean batch in one request", async () => {
    const s = server(new Set());
    await s.run([1, 2, 3]);
    expect(s.calls).toEqual([[1, 2, 3]]);
    expect(s.synced).toEqual([1, 2, 3]);
  });

  it("sets aside only the records the server refuses, and syncs the rest", async () => {
    const items = Array.from({ length: 100 }, (_, i) => i);
    const s = server(new Set([17, 64]));
    await s.run(items);
    expect(s.rejected).toEqual([17, 64]);
    expect(s.synced.sort((a, b) => a - b)).toEqual(items.filter((i) => i !== 17 && i !== 64));
    expect(s.calls.length).toBeLessThan(30); // halving, not one request per record
  });

  it("stops at a failure that isn't a record's, keeping what already went through", async () => {
    const synced: number[] = [];
    let first = true;
    const push = pushIsolating([1, 2, 3, 4], {
      send: async (batch) => {
        if (batch.length === 4) throw httpError(422, "one is bad");
        if (first) {
          first = false;
          return;
        }
        throw new AxiosError("offline");
      },
      rejection: recordRejection,
      onSynced: (batch) => synced.push(...batch),
      onRejected: () => {
        throw new Error("nothing should be set aside");
      },
    });
    await expect(push).rejects.toThrow("offline");
    expect(synced).toEqual([1, 2]);
  });
});
