import { t, textKey } from "../i18n";

// The statuses the server sends, in English words: marked so they reach the
// language files, and shown with statusText().
textKey("draft");
textKey("received");
textKey("confirmed");
textKey("delivered");
textKey("invoiced");
textKey("partial");
textKey("completed");
textKey("paid");
textKey("unpaid");
textKey("overdue");
textKey("cancelled");
textKey("planned");
textKey("in transit");
textKey("in progress");
textKey("pending");
textKey("approved");
textKey("rejected");
textKey("active");
textKey("trial");
textKey("past due");
textKey("expired");

/** A record's status as the server sends it ("in_transit"), in words in the
 *  language on screen ("in transit" in English). */
export const statusText = (status: string | null | undefined): string =>
  status ? t(status.replace(/_/g, " ")) : "";
