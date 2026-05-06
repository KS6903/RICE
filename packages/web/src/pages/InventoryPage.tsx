import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import api from "../services/api";
import { Package, Wheat, MapPin } from "lucide-react";

const BYPRODUCT_NAMES: Record<string, string> = {
  ipa: "Ipa (Rice Hull)",
  darak: "Darak (Rice Bran)",
  binlid: "Binlid (Broken Rice)",
};

export default function InventoryPage() {
  const [branchFilter, setBranchFilter] = useState<string>("");

  const branchQuery = branchFilter ? `?branch_id=${branchFilter}` : "";

  const { data: branches = [] } = useQuery({ queryKey: ["branches"], queryFn: () => api.get("/branches/").then(r => r.data) });
  const { data: milled = [] } = useQuery({ queryKey: ["milled-rice", branchFilter], queryFn: () => api.get(`/inventory/milled-rice${branchQuery}`).then(r => r.data) });
  const { data: byproducts = [] } = useQuery({ queryKey: ["byproducts", branchFilter], queryFn: () => api.get(`/inventory/byproducts${branchQuery}`).then(r => r.data) });
  const { data: palay = [] } = useQuery({ queryKey: ["palay-inventory", branchFilter], queryFn: () => api.get(`/paddy/inventory${branchQuery}`).then(r => r.data) });
  const { data: summary } = useQuery({ queryKey: ["inventory-summary", branchFilter], queryFn: () => api.get(`/inventory/summary${branchQuery}`).then(r => r.data) });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Inventory</h2>
          <p className="text-sm text-gray-500">Stock of palay, milled rice, and by-products by warehouse / branch</p>
        </div>
        <div className="flex items-center gap-2">
          <MapPin size={16} className="text-gray-400" />
          <select className="input w-auto" value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}>
            <option value="">All warehouses ({branches.length})</option>
            {branches.map((b: any) => (
              <option key={b.id} value={b.id}>{b.name}{b.is_main_branch ? " (Main)" : ""}</option>
            ))}
          </select>
        </div>
      </div>

      {summary?.by_branch && summary.by_branch.length > 0 && !branchFilter && (
        <div className="card">
          <h3 className="font-semibold text-gray-900 mb-3">Stock by warehouse</h3>
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200">
              <tr className="text-left text-gray-600">
                <th className="px-3 py-2 font-medium">Warehouse</th>
                <th className="px-3 py-2 font-medium text-right">Palay (kg)</th>
                <th className="px-3 py-2 font-medium text-right">Milled Rice (kg)</th>
                <th className="px-3 py-2 font-medium text-right">By-products (kg)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {summary.by_branch.map((row: any, i: number) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="px-3 py-2 font-medium">
                    {row.branch?.name || "Unassigned"}
                    {row.branch?.is_main_branch && <span className="badge-green ml-2">Main</span>}
                  </td>
                  <td className="px-3 py-2 text-right">{row.palay_kg.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right">{row.milled_kg.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right">{row.byproduct_kg.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="card">
          <div className="flex items-center gap-2 mb-4">
            <Wheat size={18} className="text-amber-500" />
            <h3 className="font-semibold text-gray-900">Palay (Paddy) Stock</h3>
          </div>
          <div className="space-y-2">
            {palay.map((inv: any) => (
              <div key={inv.id} className="flex justify-between items-start py-1.5 border-b border-gray-100 last:border-0">
                <div>
                  <span className="font-medium text-sm">{inv.variety?.code || "Unknown"}</span>
                  <span className="text-xs text-gray-500 ml-1">({inv.grade?.code || "—"})</span>
                  {inv.branch && (
                    <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
                      <MapPin size={10} /> {inv.branch.name}
                    </p>
                  )}
                </div>
                <div className="text-right">
                  <p className="font-semibold text-sm">{Number(inv.quantity_kg).toLocaleString()} kg</p>
                  <p className="text-xs text-gray-400">{(Number(inv.quantity_kg) / 50).toFixed(1)} cavans</p>
                </div>
              </div>
            ))}
            {palay.length === 0 && <p className="text-sm text-gray-400 text-center py-4">No palay in stock</p>}
          </div>
        </div>

        <div className="card">
          <div className="flex items-center gap-2 mb-4">
            <Package size={18} className="text-brand-600" />
            <h3 className="font-semibold text-gray-900">Milled Rice (Bigas)</h3>
          </div>
          <div className="space-y-2">
            {milled.map((inv: any) => (
              <div key={inv.id} className="flex justify-between items-start py-1.5 border-b border-gray-100 last:border-0">
                <div>
                  <span className="font-medium text-sm">{inv.variety?.code || "Unknown"}</span>
                  <span className="text-xs text-gray-500 ml-1 capitalize">({inv.grade_name})</span>
                  {inv.branch && (
                    <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
                      <MapPin size={10} /> {inv.branch.name}
                    </p>
                  )}
                </div>
                <div className="text-right">
                  <p className="font-semibold text-sm">{Number(inv.quantity_kg).toLocaleString()} kg</p>
                  <p className="text-xs text-gray-400">{(Number(inv.quantity_kg) / 50).toFixed(1)} cavans</p>
                </div>
              </div>
            ))}
            {milled.length === 0 && <p className="text-sm text-gray-400 text-center py-4">No milled rice in stock</p>}
          </div>
        </div>

        <div className="card">
          <div className="flex items-center gap-2 mb-4">
            <Package size={18} className="text-gray-500" />
            <h3 className="font-semibold text-gray-900">By-products</h3>
          </div>
          <div className="space-y-2">
            {byproducts.map((b: any) => (
              <div key={b.id} className="flex justify-between items-start py-1.5 border-b border-gray-100 last:border-0">
                <div>
                  <span className="text-sm">{BYPRODUCT_NAMES[b.byproduct_type] || b.byproduct_type}</span>
                  {b.branch && (
                    <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
                      <MapPin size={10} /> {b.branch.name}
                    </p>
                  )}
                </div>
                <span className="font-semibold text-sm">{Number(b.quantity_kg).toLocaleString()} kg</span>
              </div>
            ))}
            {byproducts.length === 0 && <p className="text-sm text-gray-400 text-center py-4">No by-products yet</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
