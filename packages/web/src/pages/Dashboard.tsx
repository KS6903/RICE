import { useQuery } from "@tanstack/react-query";
import api from "../services/api";
import { Package, Wheat, Factory, TrendingUp, AlertCircle } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { format, subDays } from "date-fns";

function StatCard({ label, value, unit, icon: Icon, color }: {
  label: string; value: string | number; unit?: string; icon: React.ElementType; color: string;
}) {
  return (
    <div className="card flex items-start gap-4">
      <div className={`p-3 rounded-xl ${color}`}>
        <Icon size={22} className="text-white" />
      </div>
      <div>
        <p className="text-sm text-gray-500">{label}</p>
        <p className="text-2xl font-bold text-gray-900">
          {typeof value === "number" ? value.toLocaleString() : value}
          {unit && <span className="text-sm font-normal text-gray-400 ml-1">{unit}</span>}
        </p>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const today = format(new Date(), "yyyy-MM-dd");
  const thirtyAgo = format(subDays(new Date(), 30), "yyyy-MM-dd");

  const { data: inventory } = useQuery({
    queryKey: ["inventory-summary"],
    queryFn: () => api.get("/inventory/summary").then((r) => r.data),
  });

  const { data: pnl } = useQuery({
    queryKey: ["pnl-dashboard"],
    queryFn: () =>
      api.get(`/reports/pnl?period_start=${thirtyAgo}&period_end=${today}`).then((r) => r.data),
  });

  const pnlChart = pnl
    ? [
        { name: "Revenue", value: pnl.revenue },
        { name: "Cost of Goods", value: pnl.cost_of_goods },
        { name: "Expenses", value: pnl.operating_expenses },
        { name: "Net Profit", value: pnl.net_profit },
      ]
    : [];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-900">Dashboard</h2>
        <p className="text-sm text-gray-500">Last 30 days overview</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Palay Stock"
          value={inventory ? Math.round(inventory.palay_total_kg).toLocaleString() : "—"}
          unit="kg"
          icon={Wheat}
          color="bg-amber-500"
        />
        <StatCard
          label="Milled Rice Stock"
          value={inventory ? Math.round(inventory.milled_rice_total_kg).toLocaleString() : "—"}
          unit="kg"
          icon={Package}
          color="bg-brand-600"
        />
        <StatCard
          label="Net Profit (30d)"
          value={pnl ? `₱${pnl.net_profit.toLocaleString()}` : "—"}
          icon={TrendingUp}
          color="bg-blue-500"
        />
        <StatCard
          label="Gross Margin"
          value={pnl ? `${pnl.gross_margin_pct}%` : "—"}
          icon={Factory}
          color="bg-purple-500"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <h3 className="font-semibold text-gray-900 mb-4">Financial Summary (30 days)</h3>
          {pnlChart.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={pnlChart}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `₱${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v: number) => `₱${v.toLocaleString()}`} />
                <Bar dataKey="value" fill="#16a34a" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-48 text-gray-400 text-sm">
              No data yet
            </div>
          )}
        </div>

        <div className="card">
          <h3 className="font-semibold text-gray-900 mb-4">By-products Stock</h3>
          {inventory?.byproducts ? (
            <div className="space-y-3">
              {Object.entries(inventory.byproducts).map(([type, kg]) => (
                <div key={type} className="flex justify-between items-center">
                  <span className="text-sm text-gray-600 capitalize">{type === "ipa" ? "Ipa (Rice Hull)" : type === "darak" ? "Darak (Rice Bran)" : "Binlid (Broken Rice)"}</span>
                  <span className="font-medium text-gray-900">{Number(kg).toLocaleString()} kg</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-gray-400 text-sm">
              <AlertCircle size={16} />
              No inventory data
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
