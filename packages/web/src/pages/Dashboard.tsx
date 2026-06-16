import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { inventoryService } from "../services/InventoryService";
import { reportsService } from "../services/ReportsService";
import {
  Package, Wheat, Factory, TrendingUp, AlertCircle, ArrowUpRight, Clock, Calendar,
} from "lucide-react";
import WeatherWidget from "../components/WeatherWidget";
import WeatherForecast from "../components/WeatherForecast";
import {
  Area, AreaChart, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import { format, startOfMonth } from "date-fns";
import { useThemeStore } from "../stores/themeStore";

type Tone = "emerald" | "violet" | "cyan" | "amber";

const TONE_STYLES: Record<Tone, { ring: string; iconBg: string }> = {
  emerald: {
    ring: "ring-emerald-500/30",
    iconBg: "bg-gradient-to-br from-emerald-400 to-emerald-600",
  },
  violet: {
    ring: "ring-violet-500/30",
    iconBg: "bg-gradient-to-br from-violet-400 to-violet-600",
  },
  cyan: {
    ring: "ring-cyan-500/30",
    iconBg: "bg-gradient-to-br from-cyan-400 to-cyan-600",
  },
  amber: {
    ring: "ring-amber-500/30",
    iconBg: "bg-gradient-to-br from-amber-400 to-amber-600",
  },
};

function StatCard({
  label,
  value,
  unit,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string | number;
  unit?: string;
  icon: React.ElementType;
  tone: Tone;
}) {
  const t = TONE_STYLES[tone];
  return (
    <div className={`card relative overflow-hidden ring-1 ring-inset ${t.ring}`}>
      <div className="absolute -top-12 -right-12 h-32 w-32 rounded-full bg-white/10 blur-2xl pointer-events-none" aria-hidden />
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold uppercase tracking-wide text-muted">{label}</p>
          <p className="mt-2 text-3xl font-extrabold tracking-tight text-primary">
            {typeof value === "number" ? value.toLocaleString() : value}
            {unit && <span className="text-base font-semibold text-secondary ml-1">{unit}</span>}
          </p>
        </div>
        <div className={`h-12 w-12 rounded-xl ${t.iconBg} grid place-items-center shadow-md shrink-0`}>
          <Icon size={22} className="text-white" />
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const today = format(new Date(), "yyyy-MM-dd");
  const monthStart = format(startOfMonth(new Date()), "yyyy-MM-dd");
  const currentMonth = format(new Date(), "yyyy-MM");
  const theme = useThemeStore((s) => s.theme);
  const isDark = theme === "dark";

  const [currentTime, setCurrentTime] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const { data: inventory } = useQuery({
    queryKey: ["inventory-summary"],
    queryFn: () => inventoryService.getSummary(),
  });

  const { data: pnl } = useQuery({
    queryKey: ["pnl-dashboard", currentMonth],
    queryFn: () => reportsService.getPnl(monthStart, today),
    refetchInterval: 60 * 60 * 1000,
  });

  const pnlChart = pnl
    ? [
        { name: "Revenue", value: pnl.revenue },
        { name: "Cost of Goods", value: pnl.cost_of_goods },
        { name: "Expenses", value: pnl.operating_expenses },
        { name: "Net Profit", value: pnl.net_profit },
      ]
    : [];

  const gridColor = isDark ? "rgba(148,163,184,0.18)" : "rgba(15,23,42,0.1)";
  const axisColor = isDark ? "#cbd5e1" : "#334155";

  return (
    <div className="space-y-7">
      {/* Hero ribbon — slim financial banner so the business KPIs and charts
          below it sit above the fold. */}
      <section className="relative overflow-hidden rounded-3xl glass-strong p-5 lg:p-6">
        <div className="absolute inset-0 pointer-events-none bg-grad-brand-anim opacity-95" aria-hidden />
        <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_top_right,_rgba(255,255,255,0.2),_transparent_55%)]" aria-hidden />
        <div className="absolute -bottom-20 -left-10 h-64 w-64 rounded-full bg-white/10 blur-3xl pointer-events-none" aria-hidden />

        <div className="relative flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
          <div className="text-white max-w-xl">
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/20 ring-1 ring-white/30 text-xs font-bold uppercase tracking-wide backdrop-blur-md">
                <Calendar size={12} />
                {format(currentTime, "EEE, MMM d, yyyy")}
              </div>
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/20 ring-1 ring-white/30 text-xs font-bold uppercase tracking-wide backdrop-blur-md">
                <Clock size={12} />
                {format(currentTime, "h:mm a")}
              </div>
            </div>
            <h1 className="mt-2 text-3xl lg:text-4xl font-extrabold tracking-tight leading-[1.05]">
              {pnl ? `₱${Number(pnl.net_profit).toLocaleString()}` : "—"}
            </h1>
            <p className="mt-1 text-white text-sm font-medium">
              Net profit · {format(new Date(), "MMMM yyyy")} · all branches
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 lg:gap-4 text-white">
            <div className="rounded-2xl bg-white/15 ring-1 ring-white/25 backdrop-blur-md px-4 py-3 min-w-[10rem]">
              <p className="text-xs font-bold uppercase tracking-wide text-white/85">Revenue</p>
              <p className="mt-1 text-xl font-bold">
                {pnl ? `₱${Number(pnl.revenue).toLocaleString()}` : "—"}
              </p>
            </div>
            <div className="rounded-2xl bg-white/15 ring-1 ring-white/25 backdrop-blur-md px-4 py-3">
              <p className="text-xs font-bold uppercase tracking-wide text-white/85">Gross margin</p>
              <p className="mt-1 text-xl font-bold flex items-center gap-1">
                {pnl ? `${pnl.gross_margin_pct}%` : "—"}
                {pnl && pnl.gross_margin_pct > 0 && <ArrowUpRight size={18} />}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Current conditions — single at-a-glance weather card up top; the full
          hourly/7-day forecast lives lower down. */}
      <section data-testid="dashboard-weather">
        <WeatherWidget variant="expanded" />
      </section>

      {/* KPI grid — operational + financial snapshot, first thing under the hero */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Palay Stock"
          value={inventory ? Math.round(inventory.palay_total_kg).toLocaleString() : "—"}
          unit="kg"
          icon={Wheat}
          tone="amber"
        />
        <StatCard
          label="Milled Rice"
          value={inventory ? Math.round(inventory.milled_rice_total_kg).toLocaleString() : "—"}
          unit="kg"
          icon={Package}
          tone="emerald"
        />
        <StatCard
          label="Net Profit (MTD)"
          value={pnl ? `₱${Number(pnl.net_profit).toLocaleString()}` : "—"}
          icon={TrendingUp}
          tone="cyan"
        />
        <StatCard
          label="Gross Margin"
          value={pnl ? `${pnl.gross_margin_pct}%` : "—"}
          icon={Factory}
          tone="violet"
        />
      </section>

      {/* Charts row */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="card lg:col-span-2">
          <div className="flex items-start justify-between mb-5">
            <div>
              <h3 className="text-lg font-bold text-primary">Financial Summary</h3>
              <p className="text-sm text-secondary mt-0.5">{format(new Date(), "MMMM yyyy")} · breakdown</p>
            </div>
            <span className="badge-violet">Live</span>
          </div>

          {pnlChart.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={pnlChart} margin={{ left: -10, right: 8, top: 4 }}>
                <defs>
                  <linearGradient id="gradFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 13, fill: axisColor, fontWeight: 500 }}
                  axisLine={{ stroke: gridColor }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 13, fill: axisColor, fontWeight: 500 }}
                  axisLine={{ stroke: gridColor }}
                  tickLine={false}
                  tickFormatter={(v) => `₱${(v / 1000).toFixed(0)}k`}
                />
                <Tooltip
                  formatter={(v: number) => `₱${v.toLocaleString()}`}
                  contentStyle={{
                    backgroundColor: isDark ? "rgba(15,23,42,0.96)" : "rgba(255,255,255,0.98)",
                    border: `1px solid ${gridColor}`,
                    borderRadius: 12,
                    boxShadow: "0 8px 24px -8px rgba(0,0,0,0.2)",
                    color: isDark ? "#f1f5f9" : "#0f172a",
                    fontWeight: 500,
                  }}
                  cursor={{ fill: isDark ? "rgba(148,163,184,0.1)" : "rgba(15,23,42,0.05)" }}
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke="#10b981"
                  strokeWidth={3}
                  fill="url(#gradFill)"
                  activeDot={{ r: 6, strokeWidth: 2, stroke: "#fff" }}
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-56 text-secondary font-medium">
              <AlertCircle size={16} className="mr-2" />
              No data yet
            </div>
          )}
        </div>

        <div className="card">
          <div className="flex items-start justify-between mb-5">
            <div>
              <h3 className="text-lg font-bold text-primary">By-products</h3>
              <p className="text-sm text-secondary mt-0.5">Current stock</p>
            </div>
          </div>

          {inventory?.byproducts ? (
            <div className="space-y-4">
              {Object.entries(inventory.byproducts).map(([type, kg]) => {
                const total = Object.values(inventory.byproducts).reduce(
                  (a: number, b) => a + Number(b),
                  0
                ) as number;
                const pct = total > 0 ? (Number(kg) / total) * 100 : 0;
                const labels: Record<string, string> = {
                  ipa: "Ipa (Rice Hull)",
                  darak: "Darak (Rice Bran)",
                  binlid: "Binlid (Broken Rice)",
                };
                const colors: Record<string, string> = {
                  ipa: "from-amber-400 to-amber-600",
                  darak: "from-cyan-400 to-cyan-600",
                  binlid: "from-violet-400 to-violet-600",
                };
                return (
                  <div key={type}>
                    <div className="flex justify-between items-baseline mb-1.5">
                      <span className="text-sm font-semibold text-secondary">
                        {labels[type] || type}
                      </span>
                      <span className="text-sm font-bold text-primary">
                        {Number(kg).toLocaleString()}
                        <span className="text-xs font-semibold text-muted ml-0.5">kg</span>
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                      <div
                        className={`h-full bg-gradient-to-r ${colors[type] || "from-emerald-400 to-emerald-600"} rounded-full transition-all`}
                        style={{ width: `${Math.max(pct, 2)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-secondary font-medium">
              <AlertCircle size={16} />
              No inventory data
            </div>
          )}
        </div>
      </section>

      {/* Detailed forecast — hourly + 7-day, secondary context placed last so
          the business summary leads. */}
      <section data-testid="dashboard-forecast">
        <WeatherForecast />
      </section>
    </div>
  );
}
