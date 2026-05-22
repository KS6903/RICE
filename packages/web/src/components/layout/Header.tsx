import { useAuthStore } from "../../stores/authStore";
import { LogOut, Wifi, WifiOff, Crown, Zap, Rocket, Star, AlertCircle } from "lucide-react";
import { useNavigate, Link } from "react-router-dom";
import { useState, useEffect } from "react";
import { useCurrentPlan } from "../../hooks/useFeature";

function PlanBadge() {
  const plan = useCurrentPlan();
  if (!plan) {
    return (
      <Link
        to="/settings"
        className="inline-flex items-center gap-1 text-xs font-medium bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full hover:bg-amber-200 transition-colors"
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
  const colors =
    plan.code === "enterprise"
      ? "bg-amber-100 text-amber-800 hover:bg-amber-200"
      : plan.code === "pro"
        ? "bg-indigo-100 text-indigo-800 hover:bg-indigo-200"
        : plan.code === "basic"
          ? "bg-blue-100 text-blue-800 hover:bg-blue-200"
          : "bg-emerald-100 text-emerald-800 hover:bg-emerald-200";

  const statusTint =
    plan.status === "active" || plan.status === "trial"
      ? "bg-emerald-500"
      : plan.status === "past_due"
        ? "bg-amber-500"
        : "bg-rose-500";

  return (
    <Link
      to="/settings"
      className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full transition-colors ${colors}`}
      title={`Plan: ${plan.name} · Status: ${plan.status}`}
    >
      <Icon size={12} />
      {plan.name}
      <span className={`w-1.5 h-1.5 rounded-full ${statusTint}`} />
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
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <header className="h-14 bg-white border-b border-gray-200 flex items-center justify-between px-6 shrink-0">
      <div />
      <div className="flex items-center gap-4">
        <PlanBadge />
        <span className={`flex items-center gap-1.5 text-xs font-medium ${isOnline ? "text-green-600" : "text-orange-500"}`}>
          {isOnline ? <Wifi size={14} /> : <WifiOff size={14} />}
          {isOnline ? "Online" : "Offline"}
        </span>
        <span className="text-sm text-gray-600">{user?.full_name}</span>
        <span className="text-xs bg-gray-100 px-2 py-0.5 rounded-full text-gray-500 capitalize">{user?.role}</span>
        <button onClick={handleLogout} className="text-gray-400 hover:text-gray-600 transition-colors">
          <LogOut size={18} />
        </button>
      </div>
    </header>
  );
}
