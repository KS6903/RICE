import { useAuthStore } from "../../stores/authStore";
import { LogOut, Wifi, WifiOff, Crown, Zap, Rocket, Star, AlertCircle } from "lucide-react";
import { useNavigate, Link } from "react-router-dom";
import { useState, useEffect } from "react";
import { useCurrentPlan } from "../../hooks/useFeature";
import LocationPicker from "../LocationPicker";
import NotificationBell from "./NotificationBell";
import BranchPicker from "./BranchPicker";
import TourButton from "../help/TourButton";
import UserAvatar from "../UserAvatar";
import { roleLabel } from "@rice-mill/shared";
import { NavDrawerButton } from "./NavDrawer";
import { useAccess } from "../../hooks/useAccess";
import { t } from "../../i18n";

function PlanBadge() {
  const plan = useCurrentPlan();
  if (!plan) {
    return (
      <Link
        to="/settings"
        className="badge-yellow hover:opacity-80 transition-opacity"
        title={t("No subscription assigned")}
      >
        <AlertCircle size={12} />
        {t("No plan")}
      </Link>
    );
  }

  const Icon =
    plan.code === "enterprise"
      ? Crown
      : plan.code === "pro"
        ? Zap
        : plan.code === "basic"
          ? Star
          : Rocket;
  const tone =
    plan.code === "enterprise"
      ? "badge-yellow"
      : plan.code === "pro"
        ? "badge-violet"
        : plan.code === "basic"
          ? "badge-cyan"
          : "badge-green";

  const statusTint =
    plan.status === "active" || plan.status === "trial"
      ? "bg-emerald-500"
      : plan.status === "past_due"
        ? "bg-amber-500"
        : "bg-rose-500";

  return (
    <Link
      to="/settings"
      className={`${tone} hover:opacity-80 transition-opacity`}
      title={t("Plan: {{name}} · Status: {{status}}", { name: plan.name, status: plan.status })}
    >
      <Icon size={12} />
      {/* A phone's header has room for the icon alone; the title names it. */}
      <span className="hidden md:inline">{plan.name}</span>
      <span className={`w-1.5 h-1.5 rounded-full ml-0.5 ${statusTint}`} />
    </Link>
  );
}

export default function Header({ menuOpen, onMenu }: { menuOpen: boolean; onMenu: () => void }) {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const { canView } = useAccess();
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const on = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  const handleLogout = async () => {
    await logout();
    navigate("/");
  };

  return (
    <header className="app-header min-h-16 glass-strong border-b border-soft flex flex-wrap sm:flex-nowrap items-center justify-between gap-2 px-3 pb-2 sm:px-6 shrink-0 relative z-10">
      <NavDrawerButton open={menuOpen} onOpen={onMenu} />
      <BranchPicker className="order-last w-full sm:order-none sm:flex-1 sm:max-w-[16rem]" />
      <div className="flex shrink-0 items-center gap-1 sm:gap-2 ml-auto min-w-0">
        {/* Weather + location picker — saved favorites follow the user across
            every page and every login. */}
        {/* The weather is the Dashboard's: a role the Boss closed it to goes without. */}
        {canView("dashboard") && <LocationPicker />}

        <span className={`hidden xl:inline-flex ${isOnline ? "badge-green" : "badge-yellow"}`}>
          {isOnline ? <Wifi size={12} /> : <WifiOff size={12} />}
          {isOnline ? t("Online") : t("Offline")}
        </span>

        {/* The tiniest screens (a fold phone's cover) need the room; Settings shows the plan. */}
        <div className="contents max-[339px]:hidden">
          <PlanBadge />
        </div>

        <TourButton />

        <NotificationBell />

        <div className="hidden xl:flex items-center gap-2.5 pl-3 border-l border-soft">
          <UserAvatar className="h-9 w-9" name={user?.full_name || user?.username} />
          <div className="hidden 2xl:block leading-tight">
            <p className="text-sm font-semibold text-primary truncate max-w-[10rem]">
              {user?.full_name}
            </p>
            <p className="text-xs text-muted font-medium">
              {user?.role_label || t(roleLabel(user?.role))}
            </p>
          </div>
        </div>

        <button
          onClick={handleLogout}
          className="h-9 w-9 grid place-items-center rounded-xl text-secondary hover:text-rose-500 hover:bg-rose-500/10 transition-colors"
          title={t("Sign out")}
          aria-label={t("Sign out")}
        >
          <LogOut size={16} />
        </button>
      </div>
    </header>
  );
}
