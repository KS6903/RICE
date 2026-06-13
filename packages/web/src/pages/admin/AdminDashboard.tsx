import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { adminService } from "../../services/AdminService";
import {
  Building2,
  Users,
  ShoppingCart,
  Wheat,
  Factory,
  TrendingUp,
  Activity,
  ArrowUpCircle,
  CreditCard,
  Inbox,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { format } from "date-fns";

function StatCard({
  label,
  value,
  icon: Icon,
  color,
  sublabel,
}: {
  label: string;
  value: string | number;
  icon: React.ElementType;
  color: string;
  sublabel?: string;
}) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-5 flex items-start gap-4">
      <div className={`p-3 rounded-xl ${color}`}>
        <Icon size={20} className="text-white" />
      </div>
      <div className="flex-1">
        <p className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide">
          {label}
        </p>
        <p className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-0.5">
          {typeof value === "number" ? value.toLocaleString() : value}
        </p>
        {sublabel && <p className="text-xs text-slate-400 mt-0.5">{sublabel}</p>}
      </div>
    </div>
  );
}

export default function AdminDashboard() {
  const { data: stats } = useQuery({
    queryKey: ["admin-stats"],
    queryFn: () => adminService.getStats(),
  });
  const { data: trend = [] } = useQuery({
    queryKey: ["admin-signups-trend"],
    queryFn: () => adminService.getSignupsTrend(30),
  });
  const { data: pending } = useQuery({
    queryKey: ["admin-pending-upgrades"],
    queryFn: () => adminService.getPendingCount(),
    refetchInterval: 5 * 1000,
    refetchOnWindowFocus: true,
    refetchIntervalInBackground: true,
  });

  const trendData = trend.map((p: any) => ({
    date: format(new Date(p.date), "MMM d"),
    count: p.count,
  }));
  const pendingCount = pending?.pending || 0;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Platform overview</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          All tenants, users, and activity across your SaaS
        </p>
      </div>

      {pendingCount > 0 && (
        <Link
          to="/admin/upgrade-requests"
          className="block rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-900/30 p-4 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-colors"
        >
          <div className="flex items-center gap-3">
            <ArrowUpCircle size={20} className="text-indigo-600 dark:text-indigo-400 shrink-0" />
            <div className="flex-1">
              <p className="font-semibold text-indigo-900 dark:text-indigo-200">
                {pendingCount} pending upgrade request{pendingCount === 1 ? "" : "s"}
              </p>
              <p className="text-sm text-indigo-700 dark:text-indigo-300">
                Tenants are waiting for plan changes — review and approve.
              </p>
            </div>
            <span className="text-indigo-700 dark:text-indigo-300 font-medium text-sm">
              Review →
            </span>
          </div>
        </Link>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total Tenants"
          value={stats?.total_tenants ?? "—"}
          icon={Building2}
          color="bg-indigo-600"
          sublabel={`${stats?.new_tenants_30d ?? 0} new in 30 days`}
        />
        <StatCard
          label="Total Users"
          value={stats?.total_users ?? "—"}
          icon={Users}
          color="bg-emerald-600"
          sublabel={`${stats?.active_users_7d ?? 0} active in 7 days`}
        />
        <StatCard
          label="Total Branches"
          value={stats?.total_branches ?? "—"}
          icon={Building2}
          color="bg-amber-600"
        />
        <StatCard
          label="Active 7 days"
          value={stats?.active_users_7d ?? "—"}
          icon={Activity}
          color="bg-rose-600"
          sublabel="users with recent login"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard
          label="Subscribed Users"
          value={stats?.subscribed_users ?? 0}
          icon={CreditCard}
          color="bg-teal-600"
          sublabel="on a paid plan"
        />
        <StatCard
          label="Unsubscribed Users"
          value={stats?.unsubscribed_users ?? 0}
          icon={CreditCard}
          color="bg-slate-500"
          sublabel="on Free or none"
        />
        <Link
          to="/admin/upgrade-requests"
          className="block focus:outline-none focus:ring-2 focus:ring-indigo-400 rounded-xl"
        >
          <StatCard
            label="Plan Requests"
            value={pendingCount}
            icon={Inbox}
            color="bg-indigo-600"
            sublabel={pendingCount > 0 ? "awaiting review" : "no pending requests"}
          />
        </Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          label="Total Purchases"
          value={stats?.total_purchases ?? "—"}
          icon={Wheat}
          color="bg-amber-500"
        />
        <StatCard
          label="Total Batches"
          value={stats?.total_batches ?? "—"}
          icon={Factory}
          color="bg-purple-600"
        />
        <StatCard
          label="Total Orders"
          value={stats?.total_orders ?? "—"}
          icon={ShoppingCart}
          color="bg-blue-600"
        />
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-slate-900 dark:text-slate-100">
            New tenant signups (30 days)
          </h3>
          <TrendingUp size={18} className="text-slate-400" />
        </div>
        {trendData.length > 0 ? (
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={trendData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip />
              <Line
                type="monotone"
                dataKey="count"
                stroke="#4f46e5"
                strokeWidth={2}
                dot={{ r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex items-center justify-center h-48 text-slate-400 text-sm">
            No signups in this window
          </div>
        )}
      </div>
    </div>
  );
}
