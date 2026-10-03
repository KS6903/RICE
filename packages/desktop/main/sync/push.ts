// Pushing a batch so that one bad record can't hold back the rest.
//
// The server takes a batch whole or not at all. When it refuses one record
// (422, 413, or a 403 marked "X-Sync-Rejection: record"), the batch is split
// in halves until each refusal is pinned to a single record, which is set
// aside; everything else goes through. Any other failure (offline, session
// over, plan lapsed, server error) stops the push as before, and the next run
// carries on from what's still pending.
import axios from "axios";

export const REJECTION_HEADER = "x-sync-rejection";

/** Why the server refused one record, or null when the failure isn't about a
 *  record (and so must stop the push, not set records aside). */
export function recordRejection(error: unknown): string | null {
  if (!axios.isAxiosError(error) || !error.response) return null;
  const { status, headers, data } = error.response;
  const marked = String(headers?.[REJECTION_HEADER] ?? "") === "record";
  // 422 and 413 are about the content sent; a 403 only when the server says so,
  // since an unmarked one refuses the account and every record alike.
  if (!(status === 422 || status === 413 || (status === 403 && marked))) return null;
  return `${status}: ${describe(data)}`;
}

function describe(data: unknown): string {
  const detail =
    typeof data === "object" && data !== null ? (data as { detail?: unknown }).detail : data;
  const text = typeof detail === "string" ? detail : JSON.stringify(detail ?? "refused");
  return text.slice(0, 300);
}

export interface Isolation<T> {
  /** Sends one batch; resolves when the server took all of it. */
  send: (batch: T[]) => Promise<void>;
  /** Classifies a failure: a record-level reason, or null to stop. */
  rejection: (error: unknown) => string | null;
  /** Called as soon as a batch is taken, so progress survives a later failure. */
  onSynced: (batch: T[]) => void;
  /** Called for each record the server refused on its own. */
  onRejected: (item: T, reason: string) => void;
}

export async function pushIsolating<T>(items: T[], how: Isolation<T>): Promise<void> {
  if (items.length === 0) return;
  try {
    await how.send(items);
  } catch (error) {
    const reason = how.rejection(error);
    if (reason === null) throw error;
    if (items.length === 1) {
      how.onRejected(items[0], reason);
      return;
    }
    const middle = Math.ceil(items.length / 2);
    await pushIsolating(items.slice(0, middle), how);
    await pushIsolating(items.slice(middle), how);
    return;
  }
  how.onSynced(items);
}
