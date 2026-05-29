import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import api from "../services/api";
import {
  Package, Wheat, MapPin, List, Table2, LayoutGrid, BarChart3, Warehouse,
  Search, ArrowUpDown, Building2, Lock, Sparkles, ArrowRight,
} from "lucide-react";
import BodegaCanvas from "../components/canvas/BodegaCanvas";
import { useFeature } from "../hooks/useFeature";

const BYPRODUCT_NAMES: Record<string, string> = {
  ipa: "Ipa (Rice Hull)",
  darak: "Darak (Rice Bran)",
  binlid: "Binlid (Broken Rice)",
};

type ViewMode = "classic" | "spreadsheet" | "cards" | "bins" | "warehouse";

type UnifiedItem = {
  id: string;
  type: "palay" | "milled" | "byproduct";
  typeLabel: string;
  variety: string;
  grade: string;
  branchId: string | null;
  branchName: string;
  quantity_kg: number;
  color: string;
};

const TYPE_COLORS: Record<UnifiedItem["type"], { fill: string; ring: string; bar: string; text: string }> = {
  palay:     { fill: "bg-amber-100 dark:bg-amber-950/40",    ring: "ring-amber-300/60",    bar: "bg-amber-500",    text: "text-amber-700 dark:text-amber-300" },
  milled:    { fill: "bg-emerald-100 dark:bg-emerald-950/40", ring: "ring-emerald-300/60", bar: "bg-emerald-500", text: "text-emerald-700 dark:text-emerald-300" },
  byproduct: { fill: "bg-slate-100 dark:bg-slate-800/60",    ring: "ring-slate-300/60",    bar: "bg-slate-500",    text: "text-slate-700 dark:text-slate-300" },
};

export default function InventoryPage() {
  const [branchFilter, setBranchFilter] = useState<string>("");
  const [view, setView] = useState<ViewMode>("classic");
  const branchQuery = branchFilter ? `?branch_id=${branchFilter}` : "";

  const { data: branches = [] } = useQuery<any[]>({ queryKey: ["branches"], queryFn: () => api.get("/branches/").then(r => r.data) });
  const { data: milled = [] } = useQuery<any[]>({ queryKey: ["milled-rice", branchFilter], queryFn: () => api.get(`/inventory/milled-rice${branchQuery}`).then(r => r.data) });
  const { data: byproducts = [] } = useQuery<any[]>({ queryKey: ["byproducts", branchFilter], queryFn: () => api.get(`/inventory/byproducts${branchQuery}`).then(r => r.data) });
  const { data: palay = [] } = useQuery<any[]>({ queryKey: ["palay-inventory", branchFilter], queryFn: () => api.get(`/paddy/inventory${branchQuery}`).then(r => r.data) });
  const { data: summary } = useQuery<any>({ queryKey: ["inventory-summary", branchFilter], queryFn: () => api.get(`/inventory/summary${branchQuery}`).then(r => r.data) });

  const items: UnifiedItem[] = useMemo(() => {
    const out: UnifiedItem[] = [];
    for (const p of palay) {
      out.push({
        id: `palay-${p.id}`, type: "palay", typeLabel: "Palay (Paddy)",
        variety: p.variety?.code || "—", grade: p.grade?.code || "—",
        branchId: p.branch_id, branchName: p.branch?.name || "Unassigned",
        quantity_kg: Number(p.quantity_kg), color: TYPE_COLORS.palay.bar,
      });
    }
    for (const m of milled) {
      out.push({
        id: `milled-${m.id}`, type: "milled", typeLabel: "Milled Rice (Bigas)",
        variety: m.variety?.code || "—", grade: m.grade_name || "—",
        branchId: m.branch_id, branchName: m.branch?.name || "Unassigned",
        quantity_kg: Number(m.quantity_kg), color: TYPE_COLORS.milled.bar,
      });
    }
    for (const b of byproducts) {
      out.push({
        id: `bp-${b.id}`, type: "byproduct", typeLabel: "By-product",
        variety: BYPRODUCT_NAMES[b.byproduct_type] || b.byproduct_type, grade: "—",
        branchId: b.branch_id, branchName: b.branch?.name || "Unassigned",
        quantity_kg: Number(b.quantity_kg), color: TYPE_COLORS.byproduct.bar,
      });
    }
    return out;
  }, [palay, milled, byproducts]);

  const totalKg = items.reduce((s, i) => s + i.quantity_kg, 0);

  const views: { key: ViewMode; label: string; icon: React.ElementType }[] = [
    { key: "classic",     label: "Classic",     icon: List },
    { key: "spreadsheet", label: "Spreadsheet", icon: Table2 },
    { key: "cards",       label: "Cards",       icon: LayoutGrid },
    { key: "bins",        label: "Bins",        icon: BarChart3 },
    { key: "warehouse",   label: "Bodega",      icon: Warehouse },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-primary">Inventory</h2>
          <p className="text-sm text-secondary">Stock of palay, milled rice, and by-products — 5 ways to view it</p>
        </div>
        <div className="flex items-center gap-2">
          <MapPin size={16} className="text-muted" />
          <select className="input w-auto" value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}>
            <option value="">All warehouses ({branches.length})</option>
            {branches.map((b: any) => (
              <option key={b.id} value={b.id}>{b.name}{b.is_main_branch ? " (Main)" : ""}</option>
            ))}
          </select>
        </div>
      </div>

      {/* View switcher */}
      <div className="flex items-center gap-1 p-1 rounded-xl glass overflow-x-auto">
        {views.map(({ key, label, icon: Icon }) => {
          const active = view === key;
          return (
            <button
              key={key}
              onClick={() => setView(key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold whitespace-nowrap transition-all ${
                active
                  ? "bg-grad-brand text-white shadow-grad-glow"
                  : "text-secondary hover:text-primary hover:bg-slate-100/60 dark:hover:bg-slate-700/30"
              }`}
            >
              <Icon size={15} />
              {label}
            </button>
          );
        })}
      </div>

      {view === "classic"     && <ClassicView palay={palay} milled={milled} byproducts={byproducts} summary={summary} branchFilter={branchFilter} />}
      {view === "spreadsheet" && <SpreadsheetView items={items} />}
      {view === "cards"       && <CardsView items={items} totalKg={totalKg} />}
      {view === "bins"        && <BinsView items={items} />}
      {view === "warehouse"   && <BodegaCanvasView branches={branches} branchFilter={branchFilter} setBranchFilter={setBranchFilter} />}
    </div>
  );
}

/* ─── 1. CLASSIC ─── the original 3-column card list */
function ClassicView({ palay, milled, byproducts, summary, branchFilter }: any) {
  return (
    <>
      {summary?.by_branch && summary.by_branch.length > 0 && !branchFilter && (
        <div className="card">
          <h3 className="font-semibold text-primary mb-3">Stock by warehouse</h3>
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 dark:border-slate-700">
              <tr className="text-left text-secondary">
                <th className="px-3 py-2 font-medium">Warehouse</th>
                <th className="px-3 py-2 font-medium text-right">Palay (kg)</th>
                <th className="px-3 py-2 font-medium text-right">Milled Rice (kg)</th>
                <th className="px-3 py-2 font-medium text-right">By-products (kg)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {summary.by_branch.map((row: any, i: number) => (
                <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="px-3 py-2 font-medium text-primary">
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
        <ClassicCard icon={<Wheat size={18} className="text-amber-500" />} title="Palay (Paddy) Stock" rows={palay} kind="palay" emptyText="No palay in stock" />
        <ClassicCard icon={<Package size={18} className="text-emerald-500" />} title="Milled Rice (Bigas)" rows={milled} kind="milled" emptyText="No milled rice in stock" />
        <ClassicCard icon={<Package size={18} className="text-slate-500" />} title="By-products" rows={byproducts} kind="byproduct" emptyText="No by-products yet" />
      </div>
    </>
  );
}

function ClassicCard({ icon, title, rows, kind, emptyText }: { icon: React.ReactNode; title: string; rows: any[]; kind: "palay" | "milled" | "byproduct"; emptyText: string }) {
  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-4">
        {icon}
        <h3 className="font-semibold text-primary">{title}</h3>
      </div>
      <div className="space-y-2">
        {rows.map((inv: any) => (
          <div key={inv.id} className="flex justify-between items-start py-1.5 border-b border-slate-100 dark:border-slate-800 last:border-0">
            <div>
              {kind === "byproduct" ? (
                <span className="text-sm text-primary">{BYPRODUCT_NAMES[inv.byproduct_type] || inv.byproduct_type}</span>
              ) : (
                <>
                  <span className="font-medium text-sm text-primary">{inv.variety?.code || "Unknown"}</span>
                  <span className="text-xs text-muted ml-1">
                    ({kind === "milled" ? inv.grade_name || "—" : inv.grade?.code || "—"})
                  </span>
                </>
              )}
              {inv.branch && (
                <p className="text-xs text-muted mt-0.5 flex items-center gap-1">
                  <MapPin size={10} /> {inv.branch.name}
                </p>
              )}
            </div>
            <div className="text-right">
              <p className="font-semibold text-sm text-primary">{Number(inv.quantity_kg).toLocaleString()} kg</p>
              {kind !== "byproduct" && (
                <p className="text-xs text-muted">{(Number(inv.quantity_kg) / 50).toFixed(1)} cavans</p>
              )}
            </div>
          </div>
        ))}
        {rows.length === 0 && <p className="text-sm text-muted text-center py-4">{emptyText}</p>}
      </div>
    </div>
  );
}

/* ─── 2. SPREADSHEET ─── flat sortable table */
function SpreadsheetView({ items }: { items: UnifiedItem[] }) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<"quantity_kg" | "typeLabel" | "variety" | "branchName">("quantity_kg");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return items
      .filter((i) => !q || i.variety.toLowerCase().includes(q) || i.branchName.toLowerCase().includes(q) || i.typeLabel.toLowerCase().includes(q))
      .sort((a, b) => {
        const av = a[sortKey]; const bv = b[sortKey];
        if (typeof av === "number" && typeof bv === "number") return sortDir === "asc" ? av - bv : bv - av;
        return sortDir === "asc" ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
      });
  }, [items, search, sortKey, sortDir]);

  const toggleSort = (k: typeof sortKey) => {
    if (sortKey === k) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortKey(k); setSortDir("desc"); }
  };

  const TH = (key: typeof sortKey, label: string) => (
    <th
      onClick={() => toggleSort(key)}
      className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 cursor-pointer select-none hover:text-primary"
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <ArrowUpDown size={11} className={sortKey === key ? "opacity-100" : "opacity-30"} />
      </span>
    </th>
  );

  return (
    <div className="card !p-0 overflow-hidden">
      <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex items-center gap-2">
        <Search size={15} className="text-muted" />
        <input
          className="input w-full max-w-md"
          placeholder="Search variety, warehouse, or type…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className="ml-auto text-xs text-muted">{filtered.length} of {items.length} rows</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-700">
            <tr>
              {TH("typeLabel", "Type")}
              {TH("variety", "Variety / Item")}
              <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">Grade</th>
              {TH("branchName", "Warehouse")}
              {TH("quantity_kg", "Quantity (kg)")}
              <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-slate-500">Cavans (50kg)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {filtered.map((i) => {
              const c = TYPE_COLORS[i.type];
              return (
                <tr key={i.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-bold ${c.fill} ${c.text} ring-1 ${c.ring}`}>
                      {i.typeLabel}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 font-medium text-primary">{i.variety}</td>
                  <td className="px-4 py-2.5 text-secondary">{i.grade}</td>
                  <td className="px-4 py-2.5 text-secondary">{i.branchName}</td>
                  <td className="px-4 py-2.5 font-semibold text-primary">{i.quantity_kg.toLocaleString()}</td>
                  <td className="px-4 py-2.5 text-right text-muted">{(i.quantity_kg / 50).toFixed(1)}</td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-muted">No matching items.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ─── 3. CARDS ─── modern card grid with progress against total */
function CardsView({ items, totalKg }: { items: UnifiedItem[]; totalKg: number }) {
  if (items.length === 0) {
    return <div className="card text-sm text-secondary text-center py-10">Inventory is empty.</div>;
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {items.map((i) => {
        const c = TYPE_COLORS[i.type];
        const pct = totalKg > 0 ? (i.quantity_kg / totalKg) * 100 : 0;
        return (
          <div key={i.id} className={`card !p-5 ring-1 ${c.ring}`}>
            <div className="flex items-start justify-between mb-3">
              <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider ${c.fill} ${c.text}`}>
                {i.typeLabel}
              </span>
              <span className="text-[10px] font-bold text-muted">{pct.toFixed(1)}% of stock</span>
            </div>
            <p className="font-bold text-lg text-primary leading-tight">{i.variety}</p>
            <p className="text-xs text-muted mt-0.5">Grade: <span className="font-medium text-secondary">{i.grade}</span></p>
            <div className="mt-4">
              <p className="text-2xl font-extrabold text-primary tabular-nums">{i.quantity_kg.toLocaleString()} <span className="text-sm font-medium text-muted">kg</span></p>
              <p className="text-xs text-muted">{(i.quantity_kg / 50).toFixed(1)} cavans</p>
            </div>
            <div className="mt-3 h-1.5 w-full bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
              <div className={`h-full ${c.bar} transition-all`} style={{ width: `${Math.min(100, pct * 2)}%` }} />
            </div>
            <p className="mt-3 text-xs text-muted flex items-center gap-1">
              <MapPin size={11} /> {i.branchName}
            </p>
          </div>
        );
      })}
    </div>
  );
}

/* ─── 4. BINS ─── horizontal bar chart, items as labeled bars */
function BinsView({ items }: { items: UnifiedItem[] }) {
  const grouped = useMemo(() => {
    const g: Record<UnifiedItem["type"], UnifiedItem[]> = { palay: [], milled: [], byproduct: [] };
    items.forEach(i => g[i.type].push(i));
    Object.values(g).forEach(arr => arr.sort((a,b) => b.quantity_kg - a.quantity_kg));
    return g;
  }, [items]);
  const maxKg = Math.max(...items.map(i => i.quantity_kg), 1);

  if (items.length === 0) {
    return <div className="card text-sm text-secondary text-center py-10">Inventory is empty.</div>;
  }

  const sections: { type: UnifiedItem["type"]; label: string; icon: React.ReactNode }[] = [
    { type: "palay",     label: "Palay (Paddy)",      icon: <Wheat size={16} className="text-amber-500" /> },
    { type: "milled",    label: "Milled Rice (Bigas)", icon: <Package size={16} className="text-emerald-500" /> },
    { type: "byproduct", label: "By-products",         icon: <Package size={16} className="text-slate-500" /> },
  ];

  return (
    <div className="space-y-6">
      {sections.map(({ type, label, icon }) => {
        const list = grouped[type];
        if (list.length === 0) return null;
        const c = TYPE_COLORS[type];
        return (
          <div key={type} className="card">
            <div className="flex items-center gap-2 mb-4">
              {icon}
              <h3 className="font-semibold text-primary">{label}</h3>
              <span className="ml-auto text-xs text-muted">{list.length} bin{list.length === 1 ? "" : "s"}</span>
            </div>
            <div className="space-y-3">
              {list.map(i => {
                const w = (i.quantity_kg / maxKg) * 100;
                return (
                  <div key={i.id}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="font-medium text-primary">
                        {i.variety} <span className="text-xs text-muted">· {i.grade} · {i.branchName}</span>
                      </span>
                      <span className="font-semibold text-primary tabular-nums">
                        {i.quantity_kg.toLocaleString()} kg <span className="text-xs text-muted">({(i.quantity_kg / 50).toFixed(0)} cavans)</span>
                      </span>
                    </div>
                    <div className="h-5 w-full bg-slate-100 dark:bg-slate-800 rounded-md overflow-hidden relative ring-1 ring-slate-200 dark:ring-slate-700">
                      <div className={`h-full ${c.bar} transition-all`} style={{ width: `${w}%` }}>
                        <div className="h-full w-full opacity-30 bg-[repeating-linear-gradient(45deg,transparent_0_6px,rgba(255,255,255,0.4)_6px_12px)]" />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ─── 5. BODEGA CANVAS ─── plan-gated Konva spatial inventory (Phase 1-4) */
function BodegaCanvasView({ branches, branchFilter, setBranchFilter }: { branches: any[]; branchFilter: string; setBranchFilter: (id: string) => void }) {
  const hasCanvas = useFeature("canvas_inventory");
  if (!hasCanvas) return <CanvasUpsellCard />;

  const activeBranchId = branchFilter || branches[0]?.id;
  if (!activeBranchId) {
    return (
      <div className="card text-center py-16">
        <Warehouse size={48} className="mx-auto text-muted mb-3" />
        <p className="text-secondary font-medium">No warehouses available.</p>
        <p className="text-xs text-muted mt-1">Create a branch first in Settings.</p>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {branches.length > 1 && (
        <div className="card !p-3 flex items-center gap-2 text-sm">
          <Building2 size={15} className="text-slate-500" />
          <span className="text-secondary">Warehouse:</span>
          <select
            className="input w-auto"
            value={activeBranchId}
            onChange={(e) => setBranchFilter(e.target.value)}
          >
            {branches.map((b: any) => (
              <option key={b.id} value={b.id}>{b.name}{b.is_main_branch ? " (Main)" : ""}</option>
            ))}
          </select>
          <span className="text-xs text-muted ml-auto">Switch instantly — each warehouse keeps its own layout.</span>
        </div>
      )}
      <BodegaCanvas branchId={activeBranchId} />
    </div>
  );
}

function CanvasUpsellCard() {
  return (
    <div className="rounded-2xl overflow-hidden ring-1 ring-slate-200 dark:ring-slate-700 bg-gradient-to-br from-indigo-50 via-violet-50 to-fuchsia-50 dark:from-indigo-950/40 dark:via-violet-950/30 dark:to-fuchsia-950/30 p-8 text-center">
      <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-white/80 dark:bg-slate-800/80 shadow-sm ring-1 ring-slate-200 dark:ring-slate-700 mb-4">
        <Lock size={22} className="text-indigo-500" />
      </div>
      <h3 className="text-xl font-bold text-primary mb-1.5">
        <Sparkles size={16} className="inline -mt-0.5 mr-1 text-amber-500" />
        Visual Bodega Canvas — a Pro feature
      </h3>
      <p className="text-sm text-secondary max-w-md mx-auto leading-relaxed">
        Drag-and-drop your pallets across a floor plan of your warehouse. See aging at a glance,
        stack visually, dispatch oldest-first, and watch live moves from any device.
      </p>
      <div className="mt-5 flex items-center justify-center gap-2">
        <Link
          to="/settings"
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-grad-brand text-white text-sm font-semibold shadow-grad-glow hover:opacity-90 transition-opacity"
        >
          Upgrade plan <ArrowRight size={14} />
        </Link>
      </div>
      <p className="text-[11px] uppercase tracking-wider font-bold text-muted mt-4">
        Available on Pro and Enterprise
      </p>
    </div>
  );
}
