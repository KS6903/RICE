import { NavLink } from "react-router-dom";
import {
  LayoutDashboard, Wheat, Factory, Package,
  ShoppingCart, Receipt, BarChart3, Users, Settings, IdCard, Lock, Sparkles, Truck, HardHat
} from "lucide-react";
import { clsx } from "clsx";
import { useFeature } from "../../hooks/useFeature";
import { useAccess } from "../../hooks/useAccess";
import { useSubLock } from "../SubscriptionGuard";
import type { AppSection } from "@rice-mill/shared";

const NAV: { to: string; label: string; icon: React.ElementType; end?: boolean; feature: string | null; section: AppSection }[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true, feature: "dashboard", section: "dashboard" },
  { to: "/paddy", label: "Paddy / Palay", icon: Wheat, feature: "paddy", section: "paddy" },
  { to: "/milling", label: "Milling", icon: Factory, feature: "milling", section: "milling" },
  { to: "/inventory", label: "Inventory", icon: Package, feature: "inventory", section: "inventory" },
  { to: "/sales", label: "Sales", icon: ShoppingCart, feature: "sales", section: "sales" },
  { to: "/dispatch", label: "Dispatch", icon: Truck, feature: "sales", section: "dispatch" },
  { to: "/operators", label: "Field Operators", icon: HardHat, feature: "sales", section: "operators" },
  { to: "/costs", label: "Expenses", icon: Receipt, feature: "expenses", section: "expenses" },
  { to: "/reports", label: "Reports", icon: BarChart3, feature: "dashboard", section: "reports" },
  { to: "/employees", label: "Employees", icon: IdCard, feature: "employees", section: "employees" },
  { to: "/users", label: "Users", icon: Users, feature: "users", section: "users" },
];

function NavItem({ to, label, icon: Icon, end, feature, locked, readOnly }: { to: string; label: string; icon: React.ElementType; end?: boolean; feature: string | null; locked?: boolean; readOnly?: boolean }) {
  const has = useFeature(feature || "dashboard");
  const allowed = has && !locked;
  const target = allowed ? to : "/settings";
  return (
    <NavLink
      key={to}
      to={target}
      end={allowed ? end : false}
      className={({ isActive }) =>
        clsx("nav-link", allowed && isActive && "is-active", !allowed && "opacity-60")
      }
      title={
        allowed
          ? readOnly ? "View only — your role can't make changes here" : undefined
          : locked
            ? "Subscription required — click to view billing"
            : "Upgrade required — click to view billing"
      }
    >
      {({ isActive }) => (
        <>
          <Icon
            size={18}
            className={clsx(
              "shrink-0 transition-colors",
              allowed && isActive ? "text-emerald-600 dark:text-emerald-400" : "text-slate-500 dark:text-slate-400"
            )}
          />
          <span className="flex-1">{label}</span>
          {allowed && readOnly && (
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              View
            </span>
          )}
          {!allowed && <Lock size={13} className="text-amber-500" />}
        </>
      )}
    </NavLink>
  );
}

export default function Sidebar() {
  const subLock = useSubLock();
  const locked = subLock !== null;
  const { canView, isReadOnly } = useAccess();
  // Hide sections the user's role can't see at all; mark view-only ones.
  const visibleNav = NAV.filter((item) => canView(item.section));
  return (
    <aside className="relative w-64 shrink-0 flex flex-col glass border-r border-soft">
      <div className="pointer-events-none absolute -top-10 -left-10 h-40 w-40 rounded-full bg-grad-brand opacity-20 blur-3xl" />

      <div className="relative px-5 py-5 border-b border-soft">
        <div className="flex items-center gap-2.5">
          <div className="h-10 w-10 rounded-xl bg-grad-brand grid place-items-center shadow-grad-glow">
            <Sparkles size={18} className="text-white" />
          </div>
          <div className="min-w-0">
            <h1 className="text-base font-bold tracking-tight text-primary leading-tight truncate">
              Rice Mill
            </h1>
            <p className="text-xs text-muted leading-tight font-medium">Pilipinas · ERP</p>
          </div>
        </div>
      </div>

      <nav className="relative flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        <p className="px-3 pb-2 text-[11px] font-bold uppercase tracking-[0.1em] text-muted">
          Operations
        </p>
        {visibleNav.map((item) => <NavItem key={item.to} {...item} locked={locked} readOnly={isReadOnly(item.section)} />)}
      </nav>

      <div className="relative px-3 py-3 border-t border-soft">
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            clsx("nav-link", isActive && "is-active", locked && "ring-2 ring-amber-400/60")
          }
        >
          <Settings size={18} className="text-slate-500 dark:text-slate-400" />
          <span className="flex-1">Settings</span>
          {locked && (
            <span className="text-[10px] font-bold uppercase tracking-wide text-amber-600 dark:text-amber-400">
              Renew
            </span>
          )}
        </NavLink>
      </div>
    </aside>
  );
}
