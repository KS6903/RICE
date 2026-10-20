import { NavLink } from "react-router-dom";
import { Settings, Lock } from "lucide-react";
import riceLogo from "../../assets/Rice_Logo.svg";
import { clsx } from "clsx";
import { useFeature } from "../../hooks/useFeature";
import { useAccess } from "../../hooks/useAccess";
import { useSubLock } from "../SubscriptionGuard";
import { NAV_GROUPS } from "./navigation";

function NavItem({
  to,
  label,
  icon: Icon,
  end,
  feature,
  locked,
  readOnly,
  hint,
}: {
  to: string;
  label: string;
  icon: React.ElementType;
  end?: boolean;
  feature: string | null;
  locked?: boolean;
  readOnly?: boolean;
  hint?: string;
}) {
  const has = useFeature(feature || "dashboard");
  const allowed = has && !locked;
  const target = allowed ? to : "/settings";
  return (
    <NavLink
      key={to}
      to={target}
      data-tour={`nav:${to}`}
      end={allowed ? end : false}
      className={({ isActive }) =>
        clsx("nav-link", allowed && isActive && "is-active", !allowed && "opacity-60")
      }
      title={
        allowed
          ? readOnly
            ? `${hint ?? label}. View only: your role can't make changes here.`
            : hint
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
              allowed && isActive
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-slate-500 dark:text-slate-400",
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
  // Hide sections the user's role can't see at all (and headings left with
  // nothing under them); mark view-only ones.
  const visibleGroups = NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((item) => canView(item.section)),
  })).filter((g) => g.items.length > 0);
  return (
    <aside className="relative w-64 shrink-0 flex flex-col glass border-r border-soft">
      <div className="pointer-events-none absolute -top-10 -left-10 h-40 w-40 rounded-full bg-grad-brand opacity-20 blur-3xl" />

      <div className="relative px-5 py-5 border-b border-soft">
        <div className="flex items-center gap-2.5">
          <div className="h-10 w-10 rounded-xl bg-grad-brand grid place-items-center shadow-grad-glow">
            <img
              src={riceLogo}
              alt="Oraiza"
              className="h-full w-full object-contain brightness-0 invert"
            />
          </div>
          <div className="min-w-0">
            <h1 className="text-base font-bold tracking-tight text-primary leading-tight truncate">
              Oraiza
            </h1>
          </div>
        </div>
      </div>

      <nav className="relative flex-1 px-3 py-4 space-y-4 overflow-y-auto">
        {visibleGroups.map((group) => (
          <div key={group.title ?? "home"} className="space-y-1">
            {group.title && (
              <p className="px-3 pb-1 text-[11px] font-bold uppercase tracking-[0.1em] text-muted">
                {group.title}
              </p>
            )}
            {group.items.map((item) => (
              <NavItem
                key={item.to}
                {...item}
                locked={locked}
                readOnly={isReadOnly(item.section)}
              />
            ))}
          </div>
        ))}
      </nav>

      <div className="relative px-3 py-3 border-t border-soft">
        <NavLink
          to="/settings"
          data-tour="nav:/settings"
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
