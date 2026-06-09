// Role-based access control matrix.
//
// Single source of truth for "who can see/do what" in the tenant app. The web
// (and desktop) UIs read this to gate navigation, routes, and action buttons.
// The backend independently enforces writes via require_roles(); this layer is
// the *interface* limit that keeps each role focused on their job.
//
// To change what a role can access, edit ROLE_ACCESS below — nothing else.

import type { Role } from "../types/domain";

/** App sections that can be access-controlled. Keep in sync with the router + sidebar. */
export type AppSection =
  | "dashboard"
  | "paddy"
  | "milling"
  | "inventory"
  | "sales"
  | "dispatch"
  | "operators"
  | "expenses"
  | "reports"
  | "employees"
  | "users"
  | "settings";

/** "full" = view + create/edit/delete · "view" = read-only · "none" = hidden/blocked. */
export type AccessLevel = "full" | "view" | "none";

const ALL_FULL: Record<AppSection, AccessLevel> = {
  dashboard: "full",
  paddy: "full",
  milling: "full",
  inventory: "full",
  sales: "full",
  dispatch: "full",
  operators: "full",
  expenses: "full",
  reports: "full",
  employees: "full",
  users: "full",
  settings: "full",
};

export const ROLE_ACCESS: Record<Role, Record<AppSection, AccessLevel>> = {
  // Management — full run of the mill.
  owner: { ...ALL_FULL },
  admin: { ...ALL_FULL },

  // Back office — books, payroll, and reporting; reads operations but doesn't run them.
  accountant: {
    dashboard: "full",
    paddy: "view",
    milling: "view",
    inventory: "view",
    sales: "full",
    dispatch: "view",
    operators: "view",
    expenses: "full",
    reports: "full",
    employees: "full",
    users: "none",
    settings: "full", // own profile/password only; sensitive tabs gated in-page
  },

  // Front desk / point of sale — takes orders, checks stock.
  cashier: {
    dashboard: "full",
    paddy: "none",
    milling: "none",
    inventory: "view",
    sales: "full",
    dispatch: "view",
    operators: "view",
    expenses: "none",
    reports: "none",
    employees: "none",
    users: "none",
    settings: "full",
  },

  // Floor staff — runs milling, manages warehouse stock and dispatch.
  mill_operator: {
    dashboard: "full",
    paddy: "full",
    milling: "full",
    inventory: "full",
    sales: "none",
    dispatch: "full",
    operators: "full",
    expenses: "none",
    reports: "none",
    employees: "none",
    users: "none",
    settings: "full",
  },

  // Secretary / data entry — encodes palay intake and sales orders.
  encoder: {
    dashboard: "full",
    paddy: "full",
    milling: "view",
    inventory: "view",
    sales: "full",
    dispatch: "none",
    operators: "none",
    expenses: "none",
    reports: "none",
    employees: "none",
    users: "none",
    settings: "full",
  },
};

/** Resolve a role's access level for a section. Unknown/empty role → "none". */
export function accessLevel(role: Role | null | undefined, section: AppSection): AccessLevel {
  if (!role) return "none";
  return ROLE_ACCESS[role]?.[section] ?? "none";
}

/** True if the role may see the section at all (view-only or full). */
export function canView(role: Role | null | undefined, section: AppSection): boolean {
  return accessLevel(role, section) !== "none";
}

/** True if the role may create/edit/delete in the section (not just read it). */
export function canEdit(role: Role | null | undefined, section: AppSection): boolean {
  return accessLevel(role, section) === "full";
}
