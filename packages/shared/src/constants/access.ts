// Role-based access control matrix: the default for each built-in role.
//
// It mirrors backend/app/core/access_policy.py, which is what the server
// enforces. A mill's Boss can change every role but their own, page by page,
// and make up roles of their own; the server sends each person's result
// (user.access), which the app prefers. This is the fallback for a server that
// doesn't send it.
//
// "settings" is the mill's settings (billing, the company, branches, the
// activity log). Everyone keeps their own account tabs whatever it says.

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
  | "settings"
  | "automations"
  | "tasks";

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
  automations: "full",
  tasks: "full",
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
    settings: "none",
    automations: "view",
    tasks: "full", // their own tasks
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
    settings: "none",
    automations: "none",
    tasks: "full", // their own tasks
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
    settings: "none",
    automations: "none",
    tasks: "full", // their own tasks
  },

  // Secretary / data entry — encodes palay intake, milling batches (custom
  // milling for walk-in clients included) and sales orders.
  encoder: {
    dashboard: "full",
    paddy: "full",
    milling: "full",
    inventory: "view",
    sales: "full",
    dispatch: "full", // who takes each order: the plate number and the driver
    operators: "none",
    expenses: "none",
    reports: "none",
    employees: "none",
    users: "none",
    settings: "none",
    automations: "none",
    tasks: "full", // their own tasks
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
