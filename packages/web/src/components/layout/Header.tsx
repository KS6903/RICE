import { useAuthStore } from "../../stores/authStore";
import { LogOut, Wifi, WifiOff, Crown, Zap, Rocket, Star, AlertCircle, Search } from "lucide-react";
import { useNavigate, Link } from "react-router-dom";
import { useState, useEffect } from "react";
import { useCurrentPlan } from "../../hooks/useFeature";
import LocationPicker from "../LocationPicker";
import NotificationBell from "./NotificationBell";
import UserAvatar from "../UserAvatar";
import { roleLabel } from "@rice-mill/shared";

function PlanBadge() {
  const plan = useCurrentPlan();
  if (!plan) {
    return (
      <Link
        to="/settings"
        className="badge-yellow hover:opacity-80 transition-opacity"
        title="No subscription assigned"
      >
        <AlertCircle size={12} />
        No plan
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
      title={`Plan: ${plan.name} · Status: ${plan.status}`}
    >
      <Icon size={12} />
      {plan.name}
      <span className={`w-1.5 h-1.5 rounded-full ml-0.5 ${statusTint}`} />
    </Link>
  );
}

export default function Header() {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
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
    navigate("/login");
  };

  return (
    <header className="h-16 glass-strong border-b border-soft flex items-center justify-between px-6 shrink-0 relative z-10">
      <div className="hidden md:flex items-center gap-2 flex-1 max-w-md">
        <div className="relative w-full">
          <Search
            size={15}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
          />
          <input
            type="text"
            placeholder="Search transactions, batches, customers…"
            className="input pl-9 pr-14"
            style={{ paddingTop: "0.5rem", paddingBottom: "0.5rem" }}
          />
          <kbd
            className="absolute right-2 top-1/2 -translate-y-1/2 hidden sm:inline-flex items-center px-1.5 py-0.5 rounded-md bg-slate-200/70 dark:bg-slate-700/70 text-[11px] font-semibold text-secondary pointer-events-none"
            aria-hidden
          >
            ⌘K
          </kbd>
        </div>
      </div>

      <div className="flex items-center gap-3 ml-auto">
        {/* Weather + location picker — saved favorites follow the user across
            every page and every login. */}
        <LocationPicker />

        <span className={`hidden sm:inline-flex ${isOnline ? "badge-green" : "badge-yellow"}`}>
          {isOnline ? <Wifi size={12} /> : <WifiOff size={12} />}
          {isOnline ? "Online" : "Offline"}
        </span>

        <PlanBadge />

        <NotificationBell />

        <div className="hidden sm:flex items-center gap-2.5 pl-3 border-l border-soft">
          <UserAvatar className="h-9 w-9" name={user?.full_name || user?.username} />
          <div className="hidden lg:block leading-tight">
            <p className="text-sm font-semibold text-primary truncate max-w-[10rem]">
              {user?.full_name}
            </p>
            <p className="text-xs text-muted font-medium">{roleLabel(user?.role)}</p>
          </div>
        </div>

        <button
          onClick={handleLogout}
          className="h-9 w-9 grid place-items-center rounded-xl text-secondary hover:text-rose-500 hover:bg-rose-500/10 transition-colors"
          title="Sign out"
        >
          <LogOut size={16} />
        </button>
      </div>
    </header>
  );
}
