import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { inventoryService } from "../services/InventoryService";
import { reportsService } from "../services/ReportsService";
import { useByproductKinds } from "../hooks/useByproductKinds";
import {
  Package,
  Wheat,
  Factory,
  TrendingUp,
  AlertCircle,
  ArrowUpRight,
  Clock,
  Calendar,
} from "lucide-react";
import WeatherWidget from "../components/WeatherWidget";
import GettingStarted from "../components/GettingStarted";
import LoadingRows from "../components/LoadingRows";
import {
  Area,
  AreaChart,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { format, startOfMonth } from "date-fns";
import { useThemeStore } from "../stores/themeStore";
import { useAccess } from "../hooks/useAccess";
import { t } from "../i18n";

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

/** "-₱359,808.02", with the minus ahead of the peso sign. */
const signedPeso = (n: number) => `${n < 0 ? "-" : ""}₱${Math.abs(n).toLocaleString()}`;

/** The figure's font size: text-3xl, or smaller when the figure is too long for
 *  its card, so a big number never pushes the icon out of place. 0.6em is a
 *  generous average width per character; a unit after it takes about 1.5rem. */
function fitFontSize(text: string, unit?: string) {
  const room = unit ? t("(100cqi - 1.5rem)") : "100cqi";
  return `min(1.875rem, calc(${room} / ${(text.length * 0.6).toFixed(2)}))`;
}

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
  const text = typeof value === "number" ? value.toLocaleString() : value;
  return (
    <div className={`card relative overflow-hidden ring-1 ring-inset ${t.ring}`}>
      <div
        className="absolute -top-12 -right-12 h-32 w-32 rounded-full bg-white/10 blur-2xl pointer-events-none"
        aria-hidden
      />
      <div className="flex items-start justify-between gap-3">
        {/* min-w-0 + flex-1: the text takes what's left beside the icon, and its
            width (not the figure's) is what 100cqi measures. */}
        <div className="min-w-0 flex-1 [container-type:inline-size]">
          <p className="text-sm font-bold uppercase tracking-wide text-muted">{label}</p>
          <p
            className="mt-2 font-extrabold leading-tight tracking-tight text-primary truncate"
            style={{ fontSize: fitFontSize(text, unit) }}
            title={unit ? `${text} ${unit}` : text}
          >
            {text}
            {unit && <span className="text-base font-semibold text-secondary ml-1">{unit}</span>}
          </p>
        </div>
        <div
          className={`h-12 w-12 rounded-xl ${t.iconBg} grid place-items-center shadow-md shrink-0`}
        >
          <Icon size={22} className="text-white" />
        </div>
      </div>
    </div>
  );
}

function DashboardClock() {
  const [currentTime, setCurrentTime] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
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
  );
}

export default function Dashboard() {
  const today = format(new Date(), "yyyy-MM-dd");
  const monthStart = format(startOfMonth(new Date()), "yyyy-MM-dd");
  const currentMonth = format(new Date(), "yyyy-MM");
  const theme = useThemeStore((s) => s.theme);
  const isDark = theme === "dark";
  const canViewReports = useAccess().canView("reports");

  // The same cache entry as Inventory's "All branches" view, so both pages
  // always show the same stock.
  const { data: inventory, isLoading: inventoryLoading } = useQuery({
    queryKey: ["inventory-summary", "", ""],
    queryFn: () => inventoryService.getSummary(),
  });
  const byproducts = Object.entries<number>(inventory?.byproducts ?? {});
  const { label: byproductName } = useByproductKinds();
  const byproductTotal = byproducts.reduce((s, [, kg]) => s + kg, 0);

  const { data: pnl, isLoading: pnlLoading } = useQuery({
    queryKey: ["pnl-dashboard", currentMonth],
    queryFn: () => reportsService.getPnl(monthStart, today),
    refetchInterval: 60 * 60 * 1000,
    enabled: canViewReports,
  });

  const pnlChart = pnl
    ? [
        { name: t("Revenue"), value: pnl.revenue },
        { name: t("Cost of Goods"), value: pnl.cost_of_goods },
        { name: t("Expenses"), value: pnl.operating_expenses },
        { name: t("Net Profit"), value: pnl.net_profit },
      ]
    : [];

  const gridColor = isDark ? "rgba(148,163,184,0.18)" : "rgba(15,23,42,0.1)";
  const axisColor = isDark ? "#cbd5e1" : "#334155";

  return (
    <div className="space-y-7">
      {/* First-run checklist; renders nothing once the mill is up and running. */}
      <GettingStarted />

      {/* Hero ribbon — slim financial banner so the business KPIs and charts
          below it sit above the fold. */}
      {canViewReports && (
        <section className="relative overflow-hidden rounded-3xl glass-strong p-5 lg:p-6">
          <div
            className="absolute inset-0 pointer-events-none bg-grad-brand-anim opacity-95"
            aria-hidden
          />
          <div
            className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_top_right,_rgba(255,255,255,0.2),_transparent_55%)]"
            aria-hidden
          />
          <div
            className="absolute -bottom-20 -left-10 h-64 w-64 rounded-full bg-white/10 blur-3xl pointer-events-none"
            aria-hidden
          />

          <div className="relative flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
            <div className="text-white max-w-xl">
              <DashboardClock />
              <h1 className="mt-2 text-3xl lg:text-4xl font-extrabold tracking-tight leading-[1.05]">
                {pnl ? signedPeso(Number(pnl.net_profit)) : "—"}
              </h1>
              <p className="mt-1 text-white text-sm font-medium">
                {t("Net profit · {{format}} · all branches", {
                  format: format(new Date(), "MMMM yyyy"),
                })}
              </p>
            </div>

            <div className="grid grid-cols-1 min-[480px]:grid-cols-2 gap-3 lg:gap-4 text-white">
              <div className="rounded-2xl bg-white/15 ring-1 ring-white/25 backdrop-blur-md px-4 py-3">
                <p className="text-xs font-bold uppercase tracking-wide text-white/85">
                  {t("Revenue")}
                </p>
                <p className="mt-1 text-xl font-bold">
                  {pnl ? `₱${Number(pnl.revenue).toLocaleString()}` : "—"}
                </p>
              </div>
              <div className="rounded-2xl bg-white/15 ring-1 ring-white/25 backdrop-blur-md px-4 py-3">
                <p className="text-xs font-bold uppercase tracking-wide text-white/85">
                  {t("Gross margin")}
                </p>
                <p className="mt-1 text-xl font-bold flex items-center gap-1">
                  {pnl ? `${pnl.gross_margin_pct}%` : "—"}
                  {pnl && pnl.gross_margin_pct > 0 && <ArrowUpRight size={18} />}
                </p>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Current conditions — single at-a-glance weather card up top; the full
          hourly/7-day forecast lives lower down. */}
      <section data-testid="dashboard-weather">
        <WeatherWidget variant="expanded" />
      </section>

      {/* KPI grid — operational + financial snapshot, first thing under the hero */}
      <section
        className={`grid grid-cols-1 sm:grid-cols-2 gap-4 ${canViewReports ? "lg:grid-cols-4" : "lg:grid-cols-2"}`}
      >
        <StatCard
          label={t("Palay Stock")}
          value={inventory ? inventory.palay_total_kg.toLocaleString() : "—"}
          unit="kg"
          icon={Wheat}
          tone="amber"
        />
        <StatCard
          label={t("Milled Rice")}
          value={inventory ? inventory.milled_rice_total_kg.toLocaleString() : "—"}
          unit="kg"
          icon={Package}
          tone="emerald"
        />
        {canViewReports && (
          <>
            <StatCard
              label={t("Net Profit (MTD)")}
              value={pnl ? signedPeso(Number(pnl.net_profit)) : "—"}
              icon={TrendingUp}
              tone="cyan"
            />
            <StatCard
              label={t("Gross Margin")}
              value={pnl ? `${pnl.gross_margin_pct}%` : "—"}
              icon={Factory}
              tone="violet"
            />
          </>
        )}
      </section>

      {/* Charts row */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {canViewReports && (
          <div className="card lg:col-span-2">
            <div className="flex items-start justify-between mb-5">
              <div>
                <h3 className="text-lg font-bold text-primary">{t("Financial Summary")}</h3>
                <p className="text-sm text-secondary mt-0.5">
                  {t("{{format}} · breakdown", { format: format(new Date(), "MMMM yyyy") })}
                </p>
              </div>
              <span className="badge-violet">{t("Live")}</span>
            </div>

            {pnlLoading ? (
              <div className="skeleton h-[260px] rounded-xl" aria-busy="true">
                <span className="sr-only">{t("Loading")}</span>
              </div>
            ) : pnlChart.length > 0 ? (
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
                      border: t("1px solid {{gridColor}}", { gridColor }),
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
              <div className="flex flex-col items-center justify-center h-56 text-center">
                <p className="flex items-center text-secondary font-medium">
                  <AlertCircle size={16} className="mr-2" />
                  {t("Nothing to chart yet this month")}
                </p>
                <p className="mt-1 text-sm text-muted max-w-xs">
                  {t("Sales and expenses you record show up here as revenue, costs and profit.")}
                </p>
              </div>
            )}
          </div>
        )}

        <div className={canViewReports ? "card" : "card lg:col-span-3"}>
          <div className="flex items-start justify-between mb-5">
            <div>
              <h3 className="text-lg font-bold text-primary">{t("By-products")}</h3>
              <p className="text-sm text-secondary mt-0.5">{t("Current stock")}</p>
            </div>
          </div>

          {inventoryLoading ? (
            <LoadingRows />
          ) : byproducts.length > 0 ? (
            <div className="space-y-4">
              {byproducts.map(([type, kg]) => {
                const pct = byproductTotal > 0 ? (kg / byproductTotal) * 100 : 0;
                const colors: Record<string, string> = {
                  ipa: "from-amber-400 to-amber-600",
                  darak: "from-cyan-400 to-cyan-600",
                  binlid: "from-violet-400 to-violet-600",
                };
                return (
                  <div key={type}>
                    <div className="flex justify-between items-baseline mb-1.5">
                      <span className="text-sm font-semibold text-secondary">
                        {byproductName(type)}
                      </span>
                      <span className="text-sm font-bold text-primary">
                        {kg.toLocaleString()}
                        <span className="text-xs font-semibold text-muted ml-0.5">{t("kg")}</span>
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
            <div className="text-sm">
              <p className="flex items-center gap-2 text-secondary font-medium">
                <AlertCircle size={16} />
                {t("No by-products yet")}
              </p>
              <p className="mt-1 text-muted">
                {t("Rice hull, bran and broken rice appear here after you mill a batch.")}
              </p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
