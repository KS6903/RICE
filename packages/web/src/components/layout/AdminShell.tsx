import { Outlet, NavLink, useNavigate } from "react-router-dom";
import { useAuthStore } from "../../stores/authStore";
import { LayoutDashboard, Building2, Users, LogOut, Shield } from "lucide-react";
import { clsx } from "clsx";

const NAV = [
  { to: "/admin", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/admin/tenants", label: "Tenants", icon: Building2 },
  { to: "/admin/users", label: "All Users", icon: Users },
];

export default function AdminShell() {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <div className="flex h-screen bg-slate-100">
      <aside className="w-60 bg-slate-900 text-white flex flex-col shrink-0">
        <div className="px-5 py-5 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Shield size={18} className="text-amber-400" />
            <h1 className="text-lg font-bold tracking-tight">Platform Admin</h1>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">Rice Mill SaaS</p>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                clsx(
                  "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                  isActive ? "bg-slate-800 text-white" : "text-slate-300 hover:bg-slate-800/60 hover:text-white"
                )
              }
            >
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="px-4 py-3 border-t border-slate-800 text-xs text-slate-400">
          v1.0.0 — SaaS Owner
        </div>
      </aside>

      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="h-14 bg-white border-b border-slate-200 flex items-center justify-between px-6 shrink-0">
          <div className="flex items-center gap-2">
            <span className="bg-amber-100 text-amber-800 text-xs font-semibold px-2 py-0.5 rounded-full">PLATFORM ADMIN</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-slate-600">{user?.full_name}</span>
            <button onClick={handleLogout} className="text-slate-400 hover:text-slate-600 transition-colors" title="Sign out">
              <LogOut size={18} />
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto px-6 py-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
