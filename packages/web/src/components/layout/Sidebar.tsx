import { NavLink } from "react-router-dom";
import {
  LayoutDashboard, Wheat, Factory, Package,
  ShoppingCart, Receipt, BarChart3, Users, Settings, IdCard, Lock
} from "lucide-react";
import { clsx } from "clsx";
import { useFeature } from "../../hooks/useFeature";
import { useSubLock } from "../SubscriptionGuard";
import BrandLogo from "../BrandLogo";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true, feature: "dashboard" as string | null },
  { to: "/paddy", label: "Paddy / Palay", icon: Wheat, feature: "paddy" },
  { to: "/milling", label: "Milling", icon: Factory, feature: "milling" },
  { to: "/inventory", label: "Inventory", icon: Package, feature: "inventory" },
  { to: "/sales", label: "Sales", icon: ShoppingCart, feature: "sales" },
  { to: "/costs", label: "Expenses", icon: Receipt, feature: "expenses" },
  { to: "/reports", label: "Reports", icon: BarChart3, feature: "dashboard" },
  { to: "/employees", label: "Employees", icon: IdCard, feature: "employees" },
  { to: "/users", label: "Users", icon: Users, feature: "users" },
];

function NavItem({ to, label, icon: Icon, end, feature, locked }: { to: string; label: string; icon: React.ElementType; end?: boolean; feature: string | null; locked?: boolean }) {
  const has = useFeature(feature || "dashboard");
  const allowed = has && !locked;
  // When the feature is missing (or the whole sub is locked), route to /settings so
  // the user can upgrade instead of landing on a "Upgrade required" placeholder.
  const target = allowed ? to : "/settings";
  return (
    <NavLink
      key={to}
      to={target}
      end={allowed ? end : false}
      className={({ isActive }) =>
        clsx(
          "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
          allowed && isActive ? "bg-brand-700 text-white" : "text-brand-200 hover:bg-brand-700/60 hover:text-white",
          !allowed && "opacity-50"
        )
      }
      title={
        allowed
          ? undefined
          : locked
            ? "Subscription required — click to view billing"
            : "Upgrade required — click to view billing"
      }
    >
      <Icon size={18} />
      <span className="flex-1">{label}</span>
      {!allowed && <Lock size={12} className="text-amber-400" />}
    </NavLink>
  );
}

export default function Sidebar() {
  const subLock = useSubLock();
  const locked = subLock !== null;
  return (
    <aside className="w-60 bg-brand-800 text-white flex flex-col shrink-0">
      <div className="px-5 py-5 border-b border-brand-700">
        <div className="flex items-center gap-2">
          <BrandLogo />
          <h1 className="text-lg font-bold tracking-tight">Rice Mill System</h1>
        </div>
        <p className="text-xs text-brand-300 mt-0.5">Pilipinas</p>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {NAV.map((item) => <NavItem key={item.to} {...item} locked={locked} />)}
      </nav>
      <div className="px-3 py-4 border-t border-brand-700">
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            clsx(
              "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
              isActive ? "bg-brand-700 text-white" : "text-brand-200 hover:bg-brand-700/60 hover:text-white",
              locked && "ring-1 ring-amber-400/60"
            )
          }
        >
          <Settings size={18} />
          <span className="flex-1">Settings</span>
          {locked && <span className="text-[10px] font-bold uppercase tracking-wide text-amber-300">Renew</span>}
        </NavLink>
      </div>
    </aside>
  );
}
