import { useId, useState } from "react";
import { NavLink } from "react-router-dom";
import { ChevronDown, Settings, Lock, X } from "lucide-react";
import riceLogo from "../../assets/Rice_Logo.svg";
import { clsx } from "clsx";
import { planHas } from "../../hooks/useFeature";
import { useAccess } from "../../hooks/useAccess";
import { useAuthStore } from "../../stores/authStore";
import { useSubLock } from "../SubscriptionGuard";
import { FEATURE_PLAN, NAV_GROUPS, PLAN_ORDER, type NavEntry } from "./navigation";
import { NavDrawer } from "./NavDrawer";
import { t } from "../../i18n";

function NavItem({
  to,
  label,
  icon: Icon,
  end,
  locked,
  readOnly,
  hint,
}: NavEntry & { locked?: boolean; readOnly?: boolean }) {
  // Locked here means the subscription has lapsed: every page waits on renewal.
  const target = locked ? "/settings" : to;
  return (
    <NavLink
      key={to}
      to={target}
      data-tour={`nav:${to}`}
      end={locked ? false : end}
      className={({ isActive }) =>
        clsx("nav-link", !locked && isActive && "is-active", locked && "opacity-60")
      }
      title={
        locked
          ? t("Subscription required — click to view billing")
          : readOnly
            ? t("{{page}}. View only: your role can't make changes here.", { page: hint ?? label })
            : hint
      }
    >
      {({ isActive }) => (
        <>
          <Icon
            size={18}
            className={clsx(
              "shrink-0 transition-colors",
              !locked && isActive
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-slate-500 dark:text-slate-400",
            )}
          />
          <span className="flex-1">{label}</span>
          {!locked && readOnly && (
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              {t("View")}
            </span>
          )}
          {locked && <Lock size={13} className="text-amber-500" />}
        </>
      )}
    </NavLink>
  );
}

const openKey = (userId: string) => `oraiza:nav-other-plans-open:${userId}`;

function readOpen(userId: string): boolean {
  try {
    return localStorage.getItem(openKey(userId)) === "1";
  } catch {
    return false;
  }
}

/** Pages that come with other plans: one quiet line at the bottom of the menu,
 *  closed until opened, grouped by the plan each comes with. Each leads to
 *  the plans in Settings. */
function OtherPlans({ items, userId }: { items: NavEntry[]; userId: string }) {
  const [open, setOpen] = useState(() => readOpen(userId));
  const listId = useId();
  const toggle = () => {
    setOpen((was) => {
      try {
        localStorage.setItem(openKey(userId), was ? "0" : "1");
      } catch {
        // Storage blocked: it stays as chosen until the page reloads.
      }
      return !was;
    });
  };
  const byPlan = PLAN_ORDER.map((plan) => ({
    plan,
    items: items.filter((i) => (FEATURE_PLAN[i.feature ?? ""] ?? "Enterprise") === plan),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="pt-3 border-t border-soft" data-testid="nav-other-plans">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={listId}
        className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-[0.1em] text-muted hover:text-secondary"
      >
        <span className="flex-1 text-left">{t("More with other plans")}</span>
        <ChevronDown
          size={14}
          className={clsx(
            "transition-transform motion-reduce:transition-none",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </button>
      {open && (
        <div id={listId} className="mt-1 space-y-3">
          {byPlan.map(({ plan, items: planItems }) => (
            <div key={plan} className="space-y-0.5" data-plan={plan}>
              <p className="px-3 text-[11px] font-semibold text-muted">{plan}</p>
              {planItems.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to="/settings"
                  className="nav-link opacity-70 hover:opacity-100"
                  title={t("{{label}} comes with the {{plan}} plan. See the plans.", {
                    label,
                    plan,
                  })}
                >
                  <Icon size={18} className="shrink-0 text-slate-400 dark:text-slate-500" />
                  <span className="flex-1">{label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const subLock = useSubLock();
  const locked = subLock !== null;
  const user = useAuthStore((s) => s.user);
  const { canView, canEdit, isReadOnly } = useAccess();
  // Only those who can change the plan see what other plans add.
  const canChangePlan = canEdit("settings");

  // Pages the role can see at all. Those on the mill's plan stay in their
  // groups, together; those on other plans wait in one line at the bottom.
  const seen = NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((item) => canView(item.section)),
  }));
  const onPlan = (item: NavEntry) => planHas(user, item.feature || "dashboard");
  const visibleGroups = seen
    .map((g) => ({ ...g, items: g.items.filter(onPlan) }))
    .filter((g) => g.items.length > 0);
  const otherPlans = seen.flatMap((g) => g.items.filter((item) => !onPlan(item)));

  return (
    <NavDrawer open={open} onClose={onClose} className="lg:w-64">
      <div className="pointer-events-none absolute -top-10 -left-10 h-40 w-40 rounded-full bg-grad-brand opacity-20 blur-3xl" />

      <div className="relative px-5 py-5 border-b border-soft">
        <div className="flex items-center gap-2.5">
          <div className="h-10 w-10 rounded-xl bg-grad-brand grid place-items-center shadow-grad-glow">
            <img
              src={riceLogo}
              alt={t("Oraiza")}
              className="h-full w-full object-contain brightness-0 invert"
            />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-base font-bold tracking-tight text-primary leading-tight truncate">
              {t("Oraiza")}
            </h1>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="lg:hidden -mr-2 h-10 w-10 grid place-items-center rounded-xl text-secondary hover:text-primary"
            aria-label={t("Close menu")}
          >
            <X size={20} />
          </button>
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
        {canChangePlan && otherPlans.length > 0 && user && (
          <OtherPlans items={otherPlans} userId={user.id} />
        )}
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
          <span className="flex-1">{t("Settings")}</span>
          {locked && (
            <span className="text-[10px] font-bold uppercase tracking-wide text-amber-600 dark:text-amber-400">
              {t("Renew")}
            </span>
          )}
        </NavLink>
      </div>
    </NavDrawer>
  );
}
