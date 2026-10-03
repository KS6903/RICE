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
  AreaChart,
  Area,
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
  tone = "neutral",
  sublabel,
  loading,
}: {
  label: string;
  value: string | number;
  icon: React.ElementType;
  tone?: "neutral" | "amber";
  sublabel?: string;
  loading?: boolean;
}) {
  return (
    <div className="card !p-5 flex items-start gap-4">
      <div className={tone === "amber" ? "icon-chip icon-chip-amber" : "icon-chip"}>
        <Icon size={18} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</p>
        {loading ? (
          <div className="skeleton h-7 w-16 mt-1.5" />
        ) : (
          <p className="text-2xl font-bold text-primary mt-0.5 tabular-nums">
            {typeof value === "number" ? value.toLocaleString() : value}
          </p>
        )}
        {sublabel && <p className="text-xs text-muted mt-0.5">{sublabel}</p>}
      </div>
    </div>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-muted mb-2.5">{children}</p>
  );
}

export default function AdminDashboard() {
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ["admin-stats"],
    queryFn: () => adminService.getStats(),
  });
  const { data: trend = [], isLoading: trendLoading } = useQuery({
    queryKey: ["admin-signups-trend"],
    queryFn: () => adminService.getSignupsTrend(30),
  });
  const { data: pending } = useQuery({
    queryKey: ["admin-pending-upgrades"],
    queryFn: () => adminService.getPendingCount(),
    refetchInterval: 30 * 1000,
    refetchOnWindowFocus: true,
    refetchIntervalInBackground: false,
  });

  const trendData = trend.map((p: any) => ({
    date: format(new Date(p.date), "MMM d"),
    count: p.count,
  }));
  const pendingCount = pending?.pending || 0;
  const loading = statsLoading;

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-primary">Platform overview</h2>
        <p className="text-sm text-muted">All tenants, users, and activity across your SaaS</p>
      </div>

      {pendingCount > 0 && (
        <Link
          to="/admin/upgrade-requests"
          className="card !p-4 flex items-center gap-3 group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
        >
          <div className="icon-chip icon-chip-amber">
            <ArrowUpCircle size={18} />
          </div>
          <div className="flex-1">
            <p className="font-semibold text-primary">
              {pendingCount} pending upgrade request{pendingCount === 1 ? "" : "s"}
            </p>
            <p className="text-sm text-muted">
              Tenants are waiting for plan changes — review and approve.
            </p>
          </div>
          <span className="link text-sm group-hover:translate-x-0.5 transition-transform">
            Review →
          </span>
        </Link>
      )}

      <section>
        <GroupLabel>Platform</GroupLabel>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label="Total tenants"
            value={stats?.total_tenants ?? 0}
            icon={Building2}
            sublabel={`${stats?.new_tenants_30d ?? 0} new in 30 days`}
            loading={loading}
          />
          <StatCard
            label="Total users"
            value={stats?.total_users ?? 0}
            icon={Users}
            sublabel={`${stats?.active_users_7d ?? 0} active in 7 days`}
            loading={loading}
          />
          <StatCard
            label="Total branches"
            value={stats?.total_branches ?? 0}
            icon={Building2}
            loading={loading}
          />
          <StatCard
            label="Active 7 days"
            value={stats?.active_users_7d ?? 0}
            icon={Activity}
            sublabel="users with recent login"
            loading={loading}
          />
        </div>
      </section>

      <section>
        <GroupLabel>Subscriptions</GroupLabel>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <StatCard
            label="Subscribed users"
            value={stats?.subscribed_users ?? 0}
            icon={CreditCard}
            sublabel="on a paid plan"
            loading={loading}
          />
          <StatCard
            label="Unsubscribed users"
            value={stats?.unsubscribed_users ?? 0}
            icon={CreditCard}
            sublabel="on Free or none"
            loading={loading}
          />
          <Link
            to="/admin/upgrade-requests"
            className="rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
          >
            <StatCard
              label="Plan requests"
              value={pendingCount}
              icon={Inbox}
              tone={pendingCount > 0 ? "amber" : "neutral"}
              sublabel={pendingCount > 0 ? "awaiting review" : "no pending requests"}
            />
          </Link>
        </div>
      </section>

      <section>
        <GroupLabel>Operations volume</GroupLabel>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard
            label="Total purchases"
            value={stats?.total_purchases ?? 0}
            icon={Wheat}
            loading={loading}
          />
          <StatCard
            label="Total batches"
            value={stats?.total_batches ?? 0}
            icon={Factory}
            loading={loading}
          />
          <StatCard
            label="Total orders"
            value={stats?.total_orders ?? 0}
            icon={ShoppingCart}
            loading={loading}
          />
        </div>
      </section>

      <div className="card">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 className="font-semibold text-primary">New tenant signups</h3>
            <p className="text-xs text-muted">Last 30 days</p>
          </div>
          <span className="icon-chip icon-chip-brand">
            <TrendingUp size={18} />
          </span>
        </div>
        {trendLoading ? (
          <div className="skeleton h-[250px] w-full" />
        ) : trendData.length > 0 ? (
          <ResponsiveContainer width="100%" height={250}>
            <AreaChart data={trendData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
              <defs>
                <linearGradient id="signupFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="rgb(148 163 184 / 0.18)"
                vertical={false}
              />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11, fill: "rgb(100 116 139)" }}
                tickLine={false}
                axisLine={{ stroke: "rgb(148 163 184 / 0.3)" }}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "rgb(100 116 139)" }}
                allowDecimals={false}
                tickLine={false}
                axisLine={false}
                width={32}
              />
              <Tooltip
                cursor={{ stroke: "rgb(16 185 129 / 0.4)" }}
                contentStyle={{
                  background: "rgb(var(--surface-raised))",
                  border: "1px solid rgb(var(--line))",
                  borderRadius: "0.75rem",
                  boxShadow: "0 8px 24px -8px rgba(15,23,42,0.25)",
                  fontSize: 12,
                }}
                labelStyle={{ color: "rgb(var(--ink-subtle))", fontWeight: 600 }}
                itemStyle={{ color: "rgb(var(--ink))" }}
              />
              <Area
                type="monotone"
                dataKey="count"
                stroke="#10b981"
                strokeWidth={2.5}
                fill="url(#signupFill)"
                dot={false}
                activeDot={{ r: 4, fill: "#10b981", strokeWidth: 0 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex flex-col items-center justify-center h-48 text-center">
            <span className="icon-chip mb-3">
              <TrendingUp size={18} />
            </span>
            <p className="text-sm font-medium text-secondary">No signups in this window</p>
            <p className="text-xs text-muted mt-0.5">New tenant signups will chart here.</p>
          </div>
        )}
      </div>
    </div>
  );
}
