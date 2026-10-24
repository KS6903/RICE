// The app's sections, grouped in the order a mill works. The sidebar draws
// them; the guided tour walks through them.
import {
  LayoutDashboard,
  Wheat,
  Factory,
  Package,
  ShoppingCart,
  Receipt,
  BarChart3,
  Users,
  IdCard,
  Truck,
  HardHat,
  Workflow,
  ListChecks,
  HandCoins,
  Wallet,
  ClipboardList,
  Library,
  Wrench,
  ShoppingBasket,
  Boxes,
} from "lucide-react";
import type { AppSection } from "@rice-mill/shared";

export type PlanName = "Basic" | "Pro" | "Enterprise";

/** The first plan that includes each feature a lower plan lacks (migration
 *  019_plan_tiers), in the order the menu lists them. */
export const FEATURE_PLAN: Record<string, PlanName> = {
  milling: "Basic",
  dispatch: "Basic",
  drying_advisor: "Basic",
  field_operators: "Pro",
  cash_count: "Pro",
  collections: "Pro",
  employees: "Pro",
  automations: "Enterprise",
};
export const PLAN_ORDER: PlanName[] = ["Basic", "Pro", "Enterprise"];

export type NavEntry = {
  to: string;
  label: string;
  icon: React.ElementType;
  end?: boolean;
  feature: string | null;
  section: AppSection;
  /** One line on hover: what the page is for, for someone who's never opened it. */
  hint: string;
};

/** Grouped in the order a mill works: palay in, milled, stocked, sold, paid
 *  for, and the team behind it. The headings alone tell a first-time user
 *  where to start. */
export const NAV_GROUPS: { title: string | null; items: NavEntry[] }[] = [
  {
    title: null,
    items: [
      {
        to: "/",
        label: "Dashboard",
        icon: LayoutDashboard,
        end: true,
        feature: "dashboard",
        section: "dashboard",
        hint: "This month's numbers at a glance, and your first steps",
      },
    ],
  },
  {
    title: "Buy & mill",
    items: [
      {
        to: "/paddy",
        label: "Paddy / Palay",
        icon: Wheat,
        feature: "paddy",
        section: "paddy",
        hint: "Record the palay you buy from farmers and traders",
      },
      {
        to: "/rice",
        label: "Rice / Bigas",
        icon: ShoppingBasket,
        feature: "paddy",
        section: "paddy",
        hint: "Record the milled rice you buy from other mills and traders",
      },
      {
        to: "/byproducts",
        label: "By-products",
        icon: Boxes,
        feature: "paddy",
        section: "paddy",
        hint: "Record the ipa, darak and binlid you buy",
      },
      {
        to: "/milling",
        label: "Milling",
        icon: Factory,
        feature: "milling",
        section: "milling",
        hint: "Batches: palay in, rice and by-products out",
      },
      {
        to: "/maintenance",
        label: "Maintenance",
        icon: Wrench,
        feature: "automations",
        section: "milling",
        hint: "When each machine is due for service",
      },
    ],
  },
  {
    title: "Stock",
    items: [
      {
        to: "/inventory",
        label: "Inventory",
        icon: Package,
        feature: "inventory",
        section: "inventory",
        hint: "What's in your warehouses right now",
      },
      {
        to: "/stock-count",
        label: "Stock count",
        icon: ClipboardList,
        feature: "automations",
        section: "inventory",
        hint: "Count what's really there and compare it with the records",
      },
      {
        to: "/catalog",
        label: "Catalog",
        icon: Library,
        feature: "dashboard",
        // The mill's lists are the Boss's (and whoever Settings is opened to).
        section: "settings",
        hint: "Varieties, categories, machines and the other lists you fill in",
      },
    ],
  },
  {
    title: "Sell",
    items: [
      {
        to: "/sales",
        label: "Sales",
        icon: ShoppingCart,
        feature: "sales",
        section: "sales",
        hint: "Customer orders, invoices and your customer list",
      },
      {
        to: "/dispatch",
        label: "Dispatch",
        icon: Truck,
        feature: "dispatch",
        section: "dispatch",
        hint: "Trucks, drivers and delivery trips",
      },
      {
        to: "/operators",
        label: "Field Operators",
        icon: HardHat,
        feature: "field_operators",
        section: "operators",
        hint: "Delivery agents, third-party millers and palay suppliers",
      },
      {
        to: "/collections",
        label: "Collections",
        icon: HandCoins,
        feature: "collections",
        section: "sales",
        hint: "Who owes you money, and who to chase first",
      },
      {
        to: "/cash",
        label: "Cash count",
        icon: Wallet,
        feature: "cash_count",
        section: "sales",
        hint: "Count the cash drawer at closing time",
      },
    ],
  },
  {
    title: "Money",
    items: [
      {
        to: "/costs",
        label: "Expenses",
        icon: Receipt,
        feature: "expenses",
        section: "expenses",
        hint: "Fuel, power, labor and everything else the mill pays for",
      },
      {
        to: "/reports",
        label: "Reports",
        icon: BarChart3,
        feature: "dashboard",
        section: "reports",
        hint: "Profit and loss, who owes you, stock value",
      },
    ],
  },
  {
    title: "Team",
    items: [
      {
        to: "/tasks",
        label: "To do",
        icon: ListChecks,
        feature: "automations",
        section: "tasks",
        hint: "Problems someone is fixing, and by when",
      },
      {
        to: "/automations",
        label: "Automations",
        icon: Workflow,
        feature: "automations",
        section: "automations",
        hint: "Reports and alerts that run by themselves",
      },
      {
        to: "/employees",
        label: "Employees",
        icon: IdCard,
        feature: "employees",
        section: "employees",
        hint: "Staff records: positions, branches, hire dates",
      },
      {
        to: "/users",
        label: "Users",
        icon: Users,
        feature: "users",
        section: "users",
        hint: "Logins for your staff, and what each role can see",
      },
    ],
  },
];
