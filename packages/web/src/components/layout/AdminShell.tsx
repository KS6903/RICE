import { Outlet, NavLink, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "../../stores/authStore";
import { useThemeStore } from "../../stores/themeStore";
import { useAccountTheme } from "../../hooks/useAccountTheme";
import { adminService } from "../../services/AdminService";
import {
  LayoutDashboard,
  Building2,
  Users,
  LogOut,
  ArrowUpCircle,
  MessageSquare,
  Settings,
  ShieldCheck,
  Sun,
  Moon,
  X,
} from "lucide-react";
import { clsx } from "clsx";
import UpgradeRequestToast from "../admin/UpgradeRequestToast";
import BrandLogo from "../BrandLogo";
import { NavDrawer, NavDrawerButton, useNavDrawer } from "./NavDrawer";
import { t } from "../../i18n";

const NAV = [
  { to: "/admin", label: t("Dashboard"), icon: LayoutDashboard, end: true },
  { to: "/admin/tenants", label: t("Tenants"), icon: Building2 },
  {
    to: "/admin/upgrade-requests",
    label: t("Upgrade Requests"),
    icon: ArrowUpCircle,
    withBadge: "upgrades" as const,
  },
  { to: "/admin/users", label: t("All Users"), icon: Users },
  { to: "/admin/feedback", label: t("Feedback"), icon: MessageSquare },
  { to: "/admin/settings", label: t("Settings"), icon: Settings },
];

function ThemeToggle() {
  const theme = useThemeStore((s) => s.theme);
  const toggle = useThemeStore((s) => s.toggle);
  const isDark = theme === "dark";
  return (
    <button
      onClick={toggle}
      className="h-9 w-9 grid place-items-center rounded-xl glass text-secondary hover:text-primary transition-colors"
      title={isDark ? t("Switch to light mode") : t("Switch to dark mode")}
      aria-label={t("Toggle theme")}
    >
      {isDark ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}

export default function AdminShell() {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  useAccountTheme();
  const nav = useNavDrawer();

  const { data: pending } = useQuery({
    queryKey: ["admin-pending-upgrades"],
    queryFn: () => adminService.getPendingCount(),
    refetchInterval: 30 * 1000,
    refetchOnWindowFocus: true,
    refetchIntervalInBackground: false,
  });
  const pendingCount = pending?.pending || 0;

  const handleLogout = async () => {
    await logout();
    navigate("/");
  };

  return (
    <div className="app-viewport flex overflow-hidden">
      <NavDrawer open={nav.open} onClose={() => nav.setOpen(false)} className="lg:w-60">
        <div className="pointer-events-none absolute -top-10 -left-10 h-40 w-40 rounded-full bg-grad-brand opacity-20 blur-3xl" />

        <div className="relative px-5 py-5 border-b border-soft">
          <div className="flex items-center gap-2.5">
            {/* The KS brand mark: the platform console wears the company's own
                logo rather than the product's rice logo. */}
            <div className="h-10 w-10 grid place-items-center">
              <BrandLogo gradient width={40} height={18} strokeWidth={6} />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-base font-bold tracking-tight text-primary leading-tight truncate">
                {t("Oraiza")}
              </h1>
              <p className="text-xs text-muted leading-tight font-medium">
                {t("Platform console")}
              </p>
            </div>
            <button
              type="button"
              onClick={() => nav.setOpen(false)}
              className="lg:hidden -mr-2 h-10 w-10 grid place-items-center rounded-xl text-secondary hover:text-primary"
              aria-label={t("Close menu")}
            >
              <X size={20} />
            </button>
          </div>
        </div>

        <nav className="relative flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          <p className="px-3 pb-2 text-[11px] font-bold uppercase tracking-[0.1em] text-muted">
            {t("Manage")}
          </p>
          {NAV.map(({ to, label, icon: Icon, end, withBadge }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) => clsx("nav-link", isActive && "is-active")}
            >
              {({ isActive }) => (
                <>
                  <Icon
                    size={18}
                    className={clsx(
                      "shrink-0 transition-colors",
                      isActive
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-slate-500 dark:text-slate-400",
                    )}
                  />
                  <span className="flex-1">{label}</span>
                  {withBadge === "upgrades" && pendingCount > 0 && (
                    <span className="badge-yellow !px-1.5 !py-0.5 text-[10px] font-bold rounded-full min-w-[18px] justify-center">
                      {pendingCount}
                    </span>
                  )}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="relative px-5 py-3 border-t border-soft text-xs text-muted font-medium">
          {t("v1.0.0 · BossAdmin")}
        </div>
      </NavDrawer>

      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        <header className="app-header min-h-16 glass-strong border-b border-soft flex flex-wrap items-center justify-between gap-2 px-3 pb-2 sm:px-6 shrink-0 relative z-10">
          <NavDrawerButton open={nav.open} onOpen={() => nav.setOpen(true)} />
          <span className="inline-flex items-center gap-1.5 badge-violet mr-auto lg:mr-0">
            <ShieldCheck size={12} />
            {t("Platform admin")}
          </span>

          <div className="flex items-center gap-2 sm:gap-3">
            <ThemeToggle />

            <div className="hidden sm:flex items-center gap-2.5 pl-3 border-l border-soft">
              {/* The BossAdmin's avatar is the KS mark, not initials. The
                  stroke is thicker than the sidebar's so it reads at this size. */}
              <div
                className="h-9 w-9 rounded-full bg-grad-brand grid place-items-center shadow-grad-glow"
                title={user?.full_name || user?.username}
              >
                <BrandLogo width={24} height={11} strokeWidth={10} className="text-white" />
              </div>
              <div className="hidden lg:block leading-tight">
                <p className="text-sm font-semibold text-primary truncate max-w-[10rem]">
                  {user?.full_name}
                </p>
                <p className="text-xs text-muted font-medium">{t("BossAdmin")}</p>
              </div>
            </div>

            <button
              onClick={handleLogout}
              className="h-9 w-9 grid place-items-center rounded-xl text-secondary hover:text-rose-500 hover:bg-rose-500/10 transition-colors"
              title={t("Sign out")}
            >
              <LogOut size={16} />
            </button>
          </div>
        </header>

        <main className="app-main flex-1 overflow-y-auto py-5 sm:py-6 lg:py-8">
          <div className="mx-auto max-w-7xl animate-grad-fade-up">
            <Outlet />
          </div>
        </main>
      </div>
      <UpgradeRequestToast />
    </div>
  );
}
