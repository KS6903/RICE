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
  if (action === "warehouse.restore") return "emerald";
  if (action === "warehouse.delete" || action === "warehouse.purge") return "rose";
  return "slate";
}
