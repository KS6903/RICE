import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { reportsService } from "../services/ReportsService";
import LegalNotice from "../components/LegalNotice";
import DatePicker from "../components/DatePicker";
import { format, startOfMonth, endOfMonth } from "date-fns";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  LineChart,
  Line,
  ReferenceLine,
} from "recharts";
import {
  Lock,
  ChevronLeft,
  ChevronRight,
  BarChart3,
  LineChart as LineChartIcon,
} from "lucide-react";
import { useFeature } from "../hooks/useFeature";
import { useThemeStore } from "../stores/themeStore";
import { t } from "../i18n";

export default function ReportsPage() {
  const [dateRange, setDateRange] = useState({
    start: format(startOfMonth(new Date()), "yyyy-MM-dd"),
    end: format(endOfMonth(new Date()), "yyyy-MM-dd"),
  });
  const [revenueYear, setRevenueYear] = useState(new Date().getFullYear());
  const [revenueChart, setRevenueChart] = useState<"bar" | "line">("bar");

  const hasAdvanced = useFeature("reports_advanced");
  const theme = useThemeStore((s) => s.theme);
  const isDark = theme === "dark";
  const gridColor = isDark ? "rgba(148,163,184,0.18)" : "rgba(15,23,42,0.1)";
  const axisColor = isDark ? "#cbd5e1" : "#334155";
  // One look for every chart here, in either theme: the tooltip takes the
  // app's surface and ink, and the hover highlight behind a bar is a faint
  // wash rather than the library's pale grey (near-white on a dark page).
  const tooltipStyle = {
    contentStyle: {
      backgroundColor: "rgb(var(--surface-raised))",
      border: t("1px solid rgb(var(--line))"),
      borderRadius: 12,
      boxShadow: "0 8px 24px -8px rgba(15,23,42,0.25)",
      fontWeight: 500,
    },
    labelStyle: { color: "rgb(var(--ink))", fontWeight: 600 },
    cursor: {
      fill: isDark ? "rgba(148,163,184,0.10)" : "rgba(15,23,42,0.05)",
      stroke: gridColor,
    },
  };
  const axisTick = { fontSize: 11, fill: axisColor, fontWeight: 500 };

  const { data: pnl } = useQuery({
    queryKey: ["pnl", dateRange.start, dateRange.end],
    queryFn: () => reportsService.getPnl(dateRange.start, dateRange.end),
  });

  const { data: arAging, isLoading: arLoading } = useQuery({
    queryKey: ["ar-aging"],
    queryFn: () => reportsService.getArAging(),
    enabled: hasAdvanced,
  });

  const { data: revenueAnnual } = useQuery({
    queryKey: ["revenue-annual", revenueYear],
    queryFn: () => reportsService.getRevenueAnnual(revenueYear),
  });

  const pnlData = pnl
    ? [
        { name: t("Revenue"), amount: pnl.revenue },
        { name: t("Cost of Goods"), amount: pnl.cost_of_goods },
        { name: t("Gross Profit"), amount: pnl.gross_profit },
        { name: t("Expenses"), amount: pnl.operating_expenses },
        { name: t("Net Profit"), amount: pnl.net_profit },
      ]
    : [];

  const arData = arAging
    ? [
        { bucket: t("Current"), amount: arAging.current },
        { bucket: t("1-30 days"), amount: arAging["1_30"] },
        { bucket: t("31-60 days"), amount: arAging["31_60"] },
        { bucket: t("61-90 days"), amount: arAging["61_90"] },
        { bucket: t("Over 90"), amount: arAging.over_90 },
      ]
    : [];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-900 dark:text-slate-100">
          {t("Reports & Analytics")}
        </h2>
        <p className="text-sm text-gray-500 dark:text-slate-400">
          {t("Profit & Loss, AR aging, inventory valuation, compliance")}
        </p>
      </div>

      <div className="card space-y-4">
        <div className="flex items-center gap-4 flex-wrap">
          <h3 className="font-semibold text-gray-900 dark:text-slate-100">{t("Profit & Loss")}</h3>
          <DatePicker
            aria-label={t("From date")}
            className="!w-44"
            value={dateRange.start}
            onChange={(v) => setDateRange((r) => ({ ...r, start: v }))}
          />
          <span className="text-gray-400">{t("to")}</span>
          <DatePicker
            aria-label={t("To date")}
            className="!w-44"
            value={dateRange.end}
            onChange={(v) => setDateRange((r) => ({ ...r, end: v }))}
          />
        </div>

        {pnl && (
          <>
            <div className="grid grid-cols-1 min-[480px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
              {[
                {
                  label: t("Revenue"),
                  value: pnl.revenue,
                  color: "text-green-600 dark:text-green-400",
                },
                { label: t("Cost of Goods"), value: pnl.cost_of_goods, color: "text-red-500" },
                {
                  label: t("Gross Profit"),
                  value: pnl.gross_profit,
                  color: "text-blue-600 dark:text-blue-400",
                },
                { label: t("Expenses"), value: pnl.operating_expenses, color: "text-red-500" },
                {
                  label: t("Net Profit"),
                  value: pnl.net_profit,
                  color:
                    pnl.net_profit >= 0
                      ? "text-green-600 dark:text-green-400"
                      : "text-red-600 dark:text-red-400",
                },
              ].map(({ label, value, color }) => (
                <div
                  key={label}
                  className="text-center p-3 bg-gray-50 dark:bg-slate-900/50 rounded-lg"
                >
                  <p className="text-xs text-gray-500 dark:text-slate-400 mb-1">{label}</p>
                  <p className={`text-lg font-bold ${color}`}>₱{value.toLocaleString()}</p>
                </div>
              ))}
            </div>
            <div className="text-right text-sm text-gray-500 dark:text-slate-400">
              {t("Gross Margin:")}{" "}
              <span className="font-semibold text-gray-900 dark:text-slate-100">
                {pnl.gross_margin_pct}%
              </span>
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={pnlData}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                <XAxis
                  dataKey="name"
                  tick={axisTick}
                  axisLine={{ stroke: gridColor }}
                  tickLine={false}
                />
                <YAxis
                  tick={axisTick}
                  axisLine={{ stroke: gridColor }}
                  tickLine={false}
                  tickFormatter={(v) => `₱${(v / 1000).toFixed(0)}k`}
                />
                <Tooltip
                  formatter={(v: number) => [`₱${v.toLocaleString()}`, t("Amount")]}
                  {...tooltipStyle}
                />
                <Bar dataKey="amount" fill="#16a34a" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </>
        )}
      </div>

      {/* Annual Revenue */}
      <div className="card space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h3 className="font-semibold text-primary">{t("Annual Revenue")}</h3>
            <p className="text-sm text-secondary mt-0.5">
              {t("Monthly revenue for {{revenueYear}}", { revenueYear })}
            </p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {/* Bar / line toggle */}
            <div className="inline-flex items-center rounded-lg bg-slate-100 dark:bg-slate-800 p-0.5">
              <button
                onClick={() => setRevenueChart("bar")}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${
                  revenueChart === "bar"
                    ? "bg-white dark:bg-slate-700 text-primary shadow-sm"
                    : "text-secondary hover:text-primary"
                }`}
              >
                <BarChart3 size={14} /> {t("Bar")}
              </button>
              <button
                onClick={() => setRevenueChart("line")}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${
                  revenueChart === "line"
                    ? "bg-white dark:bg-slate-700 text-primary shadow-sm"
                    : "text-secondary hover:text-primary"
                }`}
              >
                <LineChartIcon size={14} /> {t("Line")}
              </button>
            </div>
            {/* Year picker */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setRevenueYear((y) => y - 1)}
                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-secondary transition-colors"
              >
                <ChevronLeft size={16} />
              </button>
              <span className="text-sm font-bold text-primary w-12 text-center">{revenueYear}</span>
              <button
                onClick={() => setRevenueYear((y) => y + 1)}
                disabled={revenueYear >= new Date().getFullYear()}
                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-secondary transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        </div>

        {revenueAnnual && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
              {revenueAnnual.map((m) => (
                <div
                  key={m.month}
                  className="text-center p-2 rounded-lg bg-slate-50 dark:bg-slate-800/50"
                >
                  <p className="text-xs text-secondary font-medium">{m.month_name}</p>
                  <p className="text-sm font-bold text-primary mt-0.5">
                    {m.revenue > 0 ? `₱${(m.revenue / 1000).toFixed(0)}k` : "—"}
                  </p>
                </div>
              ))}
            </div>
            <ResponsiveContainer width="100%" height={260}>
              {revenueChart === "bar" ? (
                <BarChart data={revenueAnnual} margin={{ left: -10, right: 8, top: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                  <XAxis
                    dataKey="month_name"
                    tick={{ fontSize: 12, fill: axisColor, fontWeight: 500 }}
                    axisLine={{ stroke: gridColor }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 12, fill: axisColor, fontWeight: 500 }}
                    axisLine={{ stroke: gridColor }}
                    tickLine={false}
                    tickFormatter={(v) => `₱${(v / 1000).toFixed(0)}k`}
                  />
                  <Tooltip
                    formatter={(v: number) => [`₱${v.toLocaleString()}`, t("Revenue")]}
                    {...tooltipStyle}
                  />
                  <ReferenceLine
                    y={revenueAnnual.reduce((sum, m) => sum + m.revenue, 0) / 12}
                    stroke="#10b981"
                    strokeDasharray="4 4"
                    label={{ value: "Avg", position: "right", fontSize: 11, fill: "#10b981" }}
                  />
                  <Bar dataKey="revenue" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={48} />
                </BarChart>
              ) : (
                <LineChart data={revenueAnnual} margin={{ left: -10, right: 8, top: 4 }}>
                  <defs>
                    <linearGradient id="revLineFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                  <XAxis
                    dataKey="month_name"
                    tick={{ fontSize: 12, fill: axisColor, fontWeight: 500 }}
                    axisLine={{ stroke: gridColor }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 12, fill: axisColor, fontWeight: 500 }}
                    axisLine={{ stroke: gridColor }}
                    tickLine={false}
                    tickFormatter={(v) => `₱${(v / 1000).toFixed(0)}k`}
                  />
                  <Tooltip
                    formatter={(v: number) => [`₱${v.toLocaleString()}`, t("Revenue")]}
                    {...tooltipStyle}
                  />
                  <ReferenceLine
                    y={revenueAnnual.reduce((sum, m) => sum + m.revenue, 0) / 12}
                    stroke="#10b981"
                    strokeDasharray="4 4"
                    label={{ value: "Avg", position: "right", fontSize: 11, fill: "#10b981" }}
                  />
                  <Line
                    type="monotone"
                    dataKey="revenue"
                    stroke="#10b981"
                    strokeWidth={3}
                    fill="url(#revLineFill)"
                    dot={{ r: 3, fill: "#10b981" }}
                    activeDot={{ r: 6, strokeWidth: 2, stroke: "#fff" }}
                  />
                </LineChart>
              )}
            </ResponsiveContainer>
            <p className="text-right text-sm text-secondary">
              {t("Total:")}{" "}
              <span className="font-semibold text-primary">
                ₱{revenueAnnual.reduce((sum, m) => sum + m.revenue, 0).toLocaleString()}
              </span>
            </p>
          </>
        )}
      </div>

      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-900 dark:text-slate-100">
            {t("Accounts Receivable Aging")}
          </h3>
          {!hasAdvanced && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/40 px-2 py-1 rounded-full">
              <Lock size={11} /> {t("Pro plan required")}
            </span>
          )}
        </div>
        {!hasAdvanced ? (
          <p className="text-sm text-gray-500 dark:text-slate-400 text-center py-8">
            {t(
              "Upgrade to Pro to unlock AR aging, inventory valuation, and other advanced reports.",
            )}
          </p>
        ) : arLoading ? (
          <div className="skeleton h-[200px] rounded-xl" aria-busy="true">
            <span className="sr-only">{t("Loading")}</span>
          </div>
        ) : arData.length > 0 ? (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={arData}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
              <XAxis
                dataKey="bucket"
                tick={axisTick}
                axisLine={{ stroke: gridColor }}
                tickLine={false}
              />
              <YAxis
                tick={axisTick}
                axisLine={{ stroke: gridColor }}
                tickLine={false}
                tickFormatter={(v) => `₱${(v / 1000).toFixed(0)}k`}
              />
              <Tooltip
                formatter={(v: number) => [`₱${v.toLocaleString()}`, t("Owed")]}
                {...tooltipStyle}
              />
              <Bar dataKey="amount" fill="#f59e0b" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-sm text-gray-400 text-center py-8">
            {t("No outstanding receivables")}
          </p>
        )}
      </div>

      <LegalNotice kind="report" className="pt-1" />
    </div>
  );
}
