import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import api from "../services/api";
import { format, startOfMonth, endOfMonth } from "date-fns";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { Lock } from "lucide-react";
import { useFeature } from "../hooks/useFeature";

export default function ReportsPage() {
  const [dateRange, setDateRange] = useState({
    start: format(startOfMonth(new Date()), "yyyy-MM-dd"),
    end: format(endOfMonth(new Date()), "yyyy-MM-dd"),
  });

  const hasAdvanced = useFeature("reports_advanced");

  const { data: pnl } = useQuery({
    queryKey: ["pnl", dateRange.start, dateRange.end],
    queryFn: () => api.get(`/reports/pnl?period_start=${dateRange.start}&period_end=${dateRange.end}`).then(r => r.data),
  });

  const { data: arAging } = useQuery({
    queryKey: ["ar-aging"],
    queryFn: () => api.get("/reports/ar-aging").then(r => r.data),
    enabled: hasAdvanced,
  });

  const pnlData = pnl ? [
    { name: "Revenue", amount: pnl.revenue },
    { name: "Cost of Goods", amount: pnl.cost_of_goods },
    { name: "Gross Profit", amount: pnl.gross_profit },
    { name: "Expenses", amount: pnl.operating_expenses },
    { name: "Net Profit", amount: pnl.net_profit },
  ] : [];

  const arData = arAging ? [
    { bucket: "Current", amount: arAging.current },
    { bucket: "1-30 days", amount: arAging["1_30"] },
    { bucket: "31-60 days", amount: arAging["31_60"] },
    { bucket: "61-90 days", amount: arAging["61_90"] },
    { bucket: "Over 90", amount: arAging.over_90 },
  ] : [];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-900">Reports & Analytics</h2>
        <p className="text-sm text-gray-500">Profit & Loss, AR aging, inventory valuation, compliance</p>
      </div>

      <div className="card space-y-4">
        <div className="flex items-center gap-4 flex-wrap">
          <h3 className="font-semibold text-gray-900">Profit & Loss</h3>
          <input type="date" className="input w-40" value={dateRange.start} onChange={e => setDateRange(r => ({ ...r, start: e.target.value }))} />
          <span className="text-gray-400">to</span>
          <input type="date" className="input w-40" value={dateRange.end} onChange={e => setDateRange(r => ({ ...r, end: e.target.value }))} />
        </div>

        {pnl && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
              {[
                { label: "Revenue", value: pnl.revenue, color: "text-green-600" },
                { label: "Cost of Goods", value: pnl.cost_of_goods, color: "text-red-500" },
                { label: "Gross Profit", value: pnl.gross_profit, color: "text-blue-600" },
                { label: "Expenses", value: pnl.operating_expenses, color: "text-red-500" },
                { label: "Net Profit", value: pnl.net_profit, color: pnl.net_profit >= 0 ? "text-green-600" : "text-red-600" },
              ].map(({ label, value, color }) => (
                <div key={label} className="text-center p-3 bg-gray-50 rounded-lg">
                  <p className="text-xs text-gray-500 mb-1">{label}</p>
                  <p className={`text-lg font-bold ${color}`}>₱{value.toLocaleString()}</p>
                </div>
              ))}
            </div>
            <div className="text-right text-sm text-gray-500">
              Gross Margin: <span className="font-semibold text-gray-900">{pnl.gross_margin_pct}%</span>
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={pnlData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `₱${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v: number) => `₱${v.toLocaleString()}`} />
                <Bar dataKey="amount" fill="#16a34a" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </>
        )}
      </div>

      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-900">Accounts Receivable Aging</h3>
          {!hasAdvanced && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-100 px-2 py-1 rounded-full">
              <Lock size={11} /> Pro plan required
            </span>
          )}
        </div>
        {!hasAdvanced ? (
          <p className="text-sm text-gray-500 text-center py-8">Upgrade to Pro to unlock AR aging, inventory valuation, and other advanced reports.</p>
        ) : arData.length > 0 ? (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={arData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="bucket" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `₱${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(v: number) => `₱${v.toLocaleString()}`} />
              <Bar dataKey="amount" fill="#f59e0b" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-sm text-gray-400 text-center py-8">No outstanding receivables</p>
        )}
      </div>
    </div>
  );
}
