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
  Calculator,
  PiggyBank,
} from "lucide-react";
import type { AppSection } from "@rice-mill/shared";
import { t } from "../../i18n";

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
  page_todo: "Pro",
  profit: "Pro",
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
  /** Still being tried out: a "Beta" mark beside its name. */
  beta?: boolean;
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
        label: t("Dashboard"),
        icon: LayoutDashboard,
        end: true,
        feature: "dashboard",
        section: "dashboard",
        hint: t("This month's numbers at a glance, and your first steps"),
      },
    ],
  },
  {
    title: t("Buy & mill"),
    items: [
      {
        to: "/paddy",
        label: t("Paddy / Palay"),
        icon: Wheat,
        feature: "paddy",
        section: "paddy",
        hint: t("Record the palay you buy from farmers and traders"),
      },
      {
        to: "/rice",
        label: t("Rice / Bigas"),
        icon: ShoppingBasket,
        feature: "paddy",
        section: "paddy",
        hint: t("Record the milled rice you buy from other mills and traders"),
      },
      {
        to: "/byproducts",
        label: t("By-products"),
        icon: Boxes,
        feature: "paddy",
        section: "paddy",
        hint: t("Record the ipa, darak and binlid you buy"),
      },
      {
        to: "/profit",
        label: t("Profit calculator"),
        icon: Calculator,
        feature: "profit",
        section: "profit",
        hint: t("The price to sell at from your recovery, and what it earns"),
      },
      {
        to: "/milling",
        label: t("Milling"),
        icon: Factory,
        feature: "milling",
        section: "milling",
        hint: t("Batches: palay in, rice and by-products out"),
      },
      {
        to: "/maintenance",
        label: t("Maintenance"),
        icon: Wrench,
        feature: "automations",
        section: "milling",
        hint: t("When each machine is due for service"),
      },
    ],
  },
  {
    title: t("Stock"),
    items: [
      {
        to: "/inventory",
        label: t("Inventory"),
        icon: Package,
        feature: "inventory",
        section: "inventory",
        hint: t("What's in your warehouses right now"),
      },
      {
        to: "/stock-count",
        label: t("Stock count"),
        icon: ClipboardList,
        feature: "automations",
        section: "inventory",
        hint: t("Count what's really there and compare it with the records"),
      },
      {
        to: "/catalog",
        label: t("Catalog"),
        icon: Library,
        feature: "dashboard",
        // The mill's lists are the Boss's (and whoever Settings is opened to).
        section: "settings",
        hint: t("Varieties, categories, machines and the other lists you fill in"),
      },
    ],
  },
  {
    title: t("Sell"),
    items: [
      {
        to: "/sales",
        label: t("Sales"),
        icon: ShoppingCart,
        feature: "sales",
        section: "sales",
        hint: t("Customer orders, invoices and your customer list"),
      },
      {
        to: "/dispatch",
        label: t("Dispatch"),
        icon: Truck,
        feature: "dispatch",
        section: "dispatch",
        hint: t("Trucks, drivers and delivery trips"),
      },
      {
        to: "/operators",
        label: t("Field Operators"),
        icon: HardHat,
        feature: "field_operators",
        section: "operators",
        hint: t("Delivery agents, third-party millers and palay suppliers"),
      },
      {
        to: "/collections",
        label: t("Collections"),
        icon: HandCoins,
        feature: "collections",
        section: "sales",
        hint: t("Who owes you money, and who to chase first"),
      },
      {
        to: "/cash",
        label: t("Cash count"),
        icon: Wallet,
        feature: "cash_count",
        section: "sales",
        hint: t("Count the cash drawer at closing time"),
      },
    ],
  },
  {
    title: t("Money"),
    items: [
      {
        to: "/costs",
        label: t("Expenses"),
        icon: Receipt,
        feature: "expenses",
        section: "expenses",
        hint: t("Fuel, power, labor and everything else the mill pays for"),
      },
      {
        to: "/reports",
        label: t("Reports"),
        icon: BarChart3,
        feature: "dashboard",
        section: "reports",
        hint: t("Profit and loss, who owes you, stock value"),
      },
      {
        to: "/savings",
        label: t("Savings"),
        icon: PiggyBank,
        feature: "profit",
        // The mill's real costs and margins, so the Boss's, like the Profit calculator.
        section: "profit",
        hint: t("Where your mill loses money, and what's stopping it"),
      },
    ],
  },
  {
    title: t("Team"),
    items: [
      {
        to: "/tasks",
        label: t("To do"),
        icon: ListChecks,
        feature: "automations",
        section: "tasks",
        hint: t("Problems someone is fixing, and by when"),
      },
      {
        to: "/automations",
        label: t("Automations"),
        icon: Workflow,
        feature: "automations",
        section: "automations",
        hint: t("Reports and alerts that run by themselves"),
        beta: true,
      },
      {
        to: "/employees",
        label: t("Employees"),
        icon: IdCard,
        feature: "employees",
        section: "employees",
        hint: t("Staff records: positions, branches, hire dates"),
      },
      {
        to: "/users",
        label: t("Users"),
        icon: Users,
        feature: "users",
        section: "users",
        hint: t("Logins for your staff, and what each role can see"),
      },
    ],
  },
];
