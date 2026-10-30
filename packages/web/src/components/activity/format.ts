import { t } from "../../i18n";
// Shared rendering for activity-log rows, used by the company Settings tab and
// the platform-admin tenant-detail card so wording stays identical.

export type ActivityRow = {
  id: string;
  action: string;
  user_name: string | null;
  entity_type: string;
  entity_label: string | null;
  detail: string | null;
  created_at: string | null;
};

const ACTION_VERBS: Record<string, string> = {
  // These three are about branches (they were named before warehouses existed).
  "warehouse.delete": t("Deleted branch"),
  "warehouse.restore": t("Restored branch"),
  "warehouse.purge": t("Permanently deleted branch"),
  "storage.add": t("Added warehouse"),
  "storage.rename": t("Renamed warehouse"),
  "storage.delete": t("Deleted warehouse"),
  "data.export": t("Downloaded all data for"),
  "user.create": t("Added user"),
  "user.role_change": t("Changed the role of"),
  "user.remove": t("Removed user"),
  "user.restore": t("Restored user"),
  // Corrections to saved records; the detail lists each field, old → new.
  "sales_order.edit": t("Edited order"),
  "invoice.edit": t("Edited invoice"),
  "customer.edit": t("Edited customer"),
  "palay_purchase.edit": t("Edited palay purchase"),
  "palay_purchase.dried": t("Recorded the drying of palay purchase"),
  "palay_purchase.recovery": t("Recorded a recovery test on palay purchase"),
  "palay_purchase.recovery_removed": t("Removed a recovery test from palay purchase"),
  "rice_purchase.edit": t("Edited rice purchase"),
  "byproduct_purchase.edit": t("Edited by-product purchase"),
  "expense.edit": t("Edited expense"),
  "milling_batch.edit": t("Edited milling batch"),
  // The Boss closing the mill's account, and opening it again.
  "account.paused": t("Paused the account of"),
  "account.reopened": t("Switched back on the account of"),
  "account.deletion_requested": t("Asked to delete the account of"),
  "account.deletion_cancelled": t("Took back the request to delete"),
};

export function formatActivity(row: ActivityRow): string {
  const verb = ACTION_VERBS[row.action] ?? row.action;
  const label = row.entity_label ? ` “${row.entity_label}”` : "";
  return `${verb}${label}`;
}

export function activityActor(row: ActivityRow): string {
  return row.user_name || t("System");
}

// Tone for the row's accent dot.
export function activityTone(action: string): "rose" | "emerald" | "slate" {
  if (
    action === "warehouse.restore" ||
    action === "user.restore" ||
    action === "account.reopened" ||
    action === "account.deletion_cancelled"
  )
    return "emerald";
  if (
    action === "warehouse.delete" ||
    action === "warehouse.purge" ||
    action === "user.remove" ||
    action === "account.paused" ||
    action === "account.deletion_requested"
  )
    return "rose";
  return "slate";
}
