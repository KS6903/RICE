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
  "warehouse.delete": "Deleted warehouse",
  "warehouse.restore": "Restored warehouse",
  "warehouse.purge": "Permanently deleted warehouse",
  "data.export": "Downloaded all data for",
  "user.create": "Added user",
  "user.role_change": "Changed the role of",
  "user.remove": "Removed user",
  "user.restore": "Restored user",
  // Corrections to saved records; the detail lists each field, old → new.
  "sales_order.edit": "Edited order",
  "invoice.edit": "Edited invoice",
  "customer.edit": "Edited customer",
  // The Boss closing the mill's account, and opening it again.
  "account.paused": "Paused the account of",
  "account.reopened": "Switched back on the account of",
  "account.deletion_requested": "Asked to delete the account of",
  "account.deletion_cancelled": "Took back the request to delete",
};

export function formatActivity(row: ActivityRow): string {
  const verb = ACTION_VERBS[row.action] ?? row.action;
  const label = row.entity_label ? ` “${row.entity_label}”` : "";
  return `${verb}${label}`;
}

export function activityActor(row: ActivityRow): string {
  return row.user_name || "System";
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
