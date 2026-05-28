import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import api from "../services/api";
import {
  Package, Wheat, MapPin, List, Table2, LayoutGrid, BarChart3, Warehouse,
  Search, ArrowUpDown, Truck, Building2,
} from "lucide-react";

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
      {view === "warehouse"   && <WarehouseView items={items} branches={branches} branchFilter={branchFilter} />}
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

/* ─── 5. WAREHOUSE ─── interactive SVG floor plan of a Philippine bodega */
function WarehouseView({ items, branches, branchFilter }: { items: UnifiedItem[]; branches: any[]; branchFilter: string }) {
  const [hovered, setHovered] = useState<{ x: number; y: number; item: UnifiedItem } | null>(null);

  // Group by branch first — each branch is its own bodega
  const branchGroups = useMemo(() => {
    const map: Record<string, { name: string; items: UnifiedItem[] }> = {};
    for (const i of items) {
      const key = i.branchId || "_unassigned";
      const name = i.branchName;
      if (!map[key]) map[key] = { name, items: [] };
      map[key].items.push(i);
    }
    return Object.values(map);
  }, [items]);

  if (branchGroups.length === 0) {
    return (
      <div className="card text-center py-16">
        <Warehouse size={48} className="mx-auto text-muted mb-3" />
        <p className="text-secondary font-medium">No inventory to display in the bodega.</p>
        <p className="text-xs text-muted mt-1">Record palay purchases or milling batches first.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="card !p-4 flex items-center gap-3 flex-wrap text-xs">
        <span className="font-semibold text-secondary uppercase tracking-wide">Legend:</span>
        <LegendDot color="bg-amber-500"    label="Palay (Paddy)" />
        <LegendDot color="bg-emerald-500"  label="Milled Rice (Bigas)" />
        <LegendDot color="bg-slate-500"    label="By-products" />
        <span className="ml-auto text-muted hidden sm:inline-flex items-center gap-1">
          <Truck size={12} /> = Loading dock / Pinto ng trak
        </span>
      </div>

      {branchGroups.map((bg, idx) => (
        <BodegaPlan key={idx} branchName={bg.name} items={bg.items} onHover={setHovered} />
      ))}

      {hovered && (
        <div
          className="fixed pointer-events-none z-50 rounded-lg bg-slate-900 text-white text-xs px-3 py-2 shadow-xl ring-1 ring-white/10"
          style={{ left: hovered.x + 14, top: hovered.y + 14 }}
        >
          <p className="font-bold">{hovered.item.variety}</p>
          <p className="text-white/70">{hovered.item.typeLabel} · {hovered.item.grade}</p>
          <p className="font-mono mt-1">
            {hovered.item.quantity_kg.toLocaleString()} kg
            <span className="text-white/60"> · {(hovered.item.quantity_kg / 50).toFixed(0)} cavans</span>
          </p>
        </div>
      )}
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-secondary">
      <span className={`inline-block w-3 h-3 rounded-sm ${color}`} />
      {label}
    </span>
  );
}

/* The actual SVG bodega floor plan for one warehouse. */
function BodegaPlan({
  branchName,
  items,
  onHover,
}: {
  branchName: string;
  items: UnifiedItem[];
  onHover: (h: { x: number; y: number; item: UnifiedItem } | null) => void;
}) {
  // Floor plan dimensions (SVG viewBox)
  const W = 900;
  const H = 520;
  const wallPad = 30;
  const inner = { x: wallPad, y: wallPad, w: W - wallPad * 2, h: H - wallPad * 2 };

  // Three "bodega zones" along the warehouse: left=Palay, middle=Bigas, right=By-products
  const aisleX = inner.x + inner.w * 0.55;
  const zones = [
    { type: "palay" as const, x: inner.x + 20, y: inner.y + 60, w: inner.w * 0.32, h: inner.h - 120, label: "Bodega ng Palay", color: "rgb(245 158 11)" },
    { type: "milled" as const, x: inner.x + inner.w * 0.34, y: inner.y + 60, w: inner.w * 0.32, h: (inner.h - 140) * 0.55, label: "Bodega ng Bigas", color: "rgb(16 185 129)" },
    { type: "byproduct" as const, x: inner.x + inner.w * 0.34, y: inner.y + 60 + (inner.h - 140) * 0.55 + 20, w: inner.w * 0.32, h: (inner.h - 140) * 0.45 - 20, label: "By-products", color: "rgb(100 116 139)" },
  ];

  // Place each item as a "stack" (rectangle scaled by quantity) inside its zone, laid out in a grid
  const totalsPerType: Record<UnifiedItem["type"], number> = { palay: 0, milled: 0, byproduct: 0 };
  items.forEach(i => totalsPerType[i.type] += i.quantity_kg);

  const stacksByZone: Record<UnifiedItem["type"], { item: UnifiedItem; rect: { x: number; y: number; w: number; h: number } }[]> = {
    palay: [], milled: [], byproduct: [],
  };

  for (const z of zones) {
    const list = items.filter(i => i.type === z.type);
    if (list.length === 0) continue;

    // grid cols ~ sqrt of count, rows derived
    const cols = Math.max(1, Math.ceil(Math.sqrt(list.length)));
    const rows = Math.ceil(list.length / cols);
    const gap = 8;
    const headerH = 26;
    const usableH = z.h - headerH - 14;
    const usableW = z.w - 14;
    const cellW = (usableW - gap * (cols - 1)) / cols;
    const cellH = (usableH - gap * (rows - 1)) / rows;
    const maxQty = Math.max(...list.map(i => i.quantity_kg), 1);

    list.forEach((item, idx) => {
      const r = Math.floor(idx / cols);
      const c = idx % cols;
      const cx = z.x + 7 + c * (cellW + gap);
      const cy = z.y + headerH + r * (cellH + gap);
      // Stack height grows by quantity ratio (min 25% so empty zones still show a tile)
      const ratio = 0.25 + 0.75 * (item.quantity_kg / maxQty);
      const sh = cellH * ratio;
      const sy = cy + (cellH - sh);
      stacksByZone[z.type].push({ item, rect: { x: cx, y: sy, w: cellW, h: sh } });
    });
  }

  // Loading dock / "pinto" at bottom-center
  const dock = { x: inner.x + inner.w / 2 - 60, y: H - wallPad - 4, w: 120, h: 8 };

  return (
    <div className="card !p-0 overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center gap-2">
        <Building2 size={16} className="text-slate-500" />
        <h3 className="font-semibold text-primary">{branchName}</h3>
        <span className="text-xs text-muted ml-auto">
          Total: <span className="font-bold text-primary tabular-nums">
            {items.reduce((s, i) => s + i.quantity_kg, 0).toLocaleString()} kg
          </span>
        </span>
      </div>

      <div className="bg-stone-50 dark:bg-slate-950/40 overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-[1100px] mx-auto block" style={{ height: "auto" }}>
          {/* Concrete floor — subtle grid */}
          <defs>
            <pattern id="concrete" width="40" height="40" patternUnits="userSpaceOnUse">
              <rect width="40" height="40" fill="#f5f5f4" />
              <path d="M0 0 L40 0 M0 0 L0 40" stroke="#e7e5e4" strokeWidth="1" />
            </pattern>
            <pattern id="concrete-dark" width="40" height="40" patternUnits="userSpaceOnUse">
              <rect width="40" height="40" fill="#1c1917" />
              <path d="M0 0 L40 0 M0 0 L0 40" stroke="#292524" strokeWidth="1" />
            </pattern>
            <filter id="sackshadow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="2" stdDeviation="1.5" floodOpacity="0.25" />
            </filter>
          </defs>

          {/* Outer wall: galvanized iron + concrete plinth — classic Pinoy bodega */}
          <rect x={0} y={0} width={W} height={H} fill="url(#concrete)" className="dark:hidden" />
          <rect x={0} y={0} width={W} height={H} fill="url(#concrete-dark)" className="hidden dark:block" />

          {/* Building outline */}
          <rect x={wallPad - 4} y={wallPad - 4} width={inner.w + 8} height={inner.h + 8} fill="none" stroke="#475569" strokeWidth="3" rx="6" />
          <rect x={wallPad} y={wallPad} width={inner.w} height={inner.h} fill="#fafaf9" className="dark:fill-slate-900" stroke="#94a3b8" strokeWidth="1" />

          {/* Building label */}
          <text x={inner.x + inner.w / 2} y={inner.y + 30} textAnchor="middle"
                className="fill-slate-500 dark:fill-slate-400"
                fontSize="14" fontWeight="700" letterSpacing="2">
            BODEGA · {branchName.toUpperCase()}
          </text>

          {/* North arrow / compass */}
          <g transform={`translate(${W - 70}, 65)`}>
            <circle r="18" fill="white" stroke="#cbd5e1" strokeWidth="1" className="dark:fill-slate-800" />
            <path d="M 0 -12 L 5 6 L 0 2 L -5 6 Z" fill="#0f172a" className="dark:fill-slate-100" />
            <text y={-22} textAnchor="middle" fontSize="9" fontWeight="700" className="fill-slate-600 dark:fill-slate-300">N</text>
          </g>

          {/* Office / receiving area (right column) */}
          <g>
            <rect
              x={aisleX + 10}
              y={inner.y + 60}
              width={inner.w - (aisleX - inner.x) - 20}
              height={120}
              fill="#fef3c7"
              stroke="#f59e0b"
              strokeWidth="1.5"
              strokeDasharray="4 4"
              opacity="0.6"
              rx="4"
            />
            <text
              x={aisleX + 10 + (inner.w - (aisleX - inner.x) - 20) / 2}
              y={inner.y + 60 + 30}
              textAnchor="middle"
              fontSize="11"
              fontWeight="700"
              className="fill-amber-700"
            >
              OPISINA
            </text>
            <text
              x={aisleX + 10 + (inner.w - (aisleX - inner.x) - 20) / 2}
              y={inner.y + 60 + 46}
              textAnchor="middle"
              fontSize="9"
              className="fill-amber-600"
            >
              (Office / Receiving)
            </text>
          </g>

          {/* Aisle marking */}
          <line x1={aisleX} y1={inner.y + 50} x2={aisleX} y2={inner.y + inner.h - 30} stroke="#cbd5e1" strokeWidth="2" strokeDasharray="2 6" />
          <text x={aisleX} y={inner.y + inner.h - 14} textAnchor="middle" fontSize="9" className="fill-slate-500 dark:fill-slate-400" fontWeight="600">
            ← AISLE / PASILYO →
          </text>

          {/* Zones */}
          {zones.map((z) => (
            <g key={z.type}>
              <rect
                x={z.x} y={z.y} width={z.w} height={z.h}
                fill="white"
                stroke={z.color}
                strokeWidth="1.5"
                strokeDasharray="3 3"
                rx="4"
                opacity="0.9"
                className="dark:fill-slate-800/70"
              />
              <text x={z.x + z.w / 2} y={z.y + 16} textAnchor="middle" fontSize="11" fontWeight="700" fill={z.color}>
                {z.label.toUpperCase()}
              </text>
              <text x={z.x + z.w / 2} y={z.y + z.h - 6} textAnchor="middle" fontSize="9" className="fill-slate-500 dark:fill-slate-400">
                {totalsPerType[z.type].toLocaleString()} kg · {(totalsPerType[z.type] / 50).toFixed(0)} cavans
              </text>
            </g>
          ))}

          {/* Stacks (sacks of rice) */}
          {(["palay", "milled", "byproduct"] as const).flatMap((t) =>
            stacksByZone[t].map(({ item, rect }) => {
              const z = zones.find(zz => zz.type === t)!;
              return (
                <g
                  key={item.id}
                  onMouseMove={(e) => onHover({ x: e.clientX, y: e.clientY, item })}
                  onMouseLeave={() => onHover(null)}
                  style={{ cursor: "pointer" }}
                >
                  {/* Stack base */}
                  <rect
                    x={rect.x}
                    y={rect.y}
                    width={rect.w}
                    height={rect.h}
                    rx="2"
                    fill={z.color}
                    opacity="0.85"
                    filter="url(#sackshadow)"
                  />
                  {/* Stack ridges = individual cavans */}
                  {(() => {
                    const ridges = Math.min(5, Math.max(1, Math.floor(rect.h / 8)));
                    return Array.from({ length: ridges }).map((_, k) => (
                      <line
                        key={k}
                        x1={rect.x + 2}
                        y1={rect.y + ((k + 1) * rect.h) / (ridges + 1)}
                        x2={rect.x + rect.w - 2}
                        y2={rect.y + ((k + 1) * rect.h) / (ridges + 1)}
                        stroke="white"
                        strokeWidth="0.7"
                        opacity="0.4"
                      />
                    ));
                  })()}
                  {/* Label if there's room */}
                  {rect.w > 36 && rect.h > 20 && (
                    <text
                      x={rect.x + rect.w / 2}
                      y={rect.y + rect.h / 2 + 3}
                      textAnchor="middle"
                      fontSize={Math.min(10, rect.w / 5)}
                      fill="white"
                      fontWeight="700"
                      style={{ pointerEvents: "none" }}
                    >
                      {item.variety}
                    </text>
                  )}
                </g>
              );
            })
          )}

          {/* Loading dock + door */}
          <g>
            <rect x={dock.x} y={dock.y} width={dock.w} height={dock.h} fill="#475569" rx="2" />
            <rect x={dock.x - 4} y={dock.y - 14} width={dock.w + 8} height={14} fill="#facc15" rx="2" stroke="#a16207" strokeWidth="1" />
            <text x={dock.x + dock.w / 2} y={H - 10} textAnchor="middle" fontSize="10" fontWeight="700" className="fill-slate-600 dark:fill-slate-300">
              PINTO / LOADING DOCK
            </text>
          </g>

          {/* Side door */}
          <g>
            <rect x={wallPad - 4} y={inner.y + inner.h / 2 - 22} width={8} height={44} fill="#94a3b8" rx="1" />
            <DoorOpenIcon x={wallPad - 24} y={inner.y + inner.h / 2 - 8} />
          </g>
        </svg>
      </div>
    </div>
  );
}

function DoorOpenIcon({ x, y }: { x: number; y: number }) {
  // Tiny inline door icon
  return (
    <g transform={`translate(${x}, ${y})`}>
      <rect x={0} y={0} width={14} height={16} fill="none" stroke="#64748b" strokeWidth="1" />
      <circle cx={10} cy={8} r="0.8" fill="#64748b" />
    </g>
  );
}
