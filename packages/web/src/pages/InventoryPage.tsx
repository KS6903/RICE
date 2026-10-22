import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Package,
  Wheat,
  MapPin,
  List,
  Table2,
  LayoutGrid,
  BarChart3,
  Warehouse,
  Search,
  ArrowUpDown,
  Building2,
  Lock,
  Sparkles,
  ArrowRight,
  Plus,
} from "lucide-react";
import NewWarehouseView from "../components/warehouse/NewWarehouseView";
import InventoryDetailDrawer from "../components/inventory/InventoryDetailDrawer";
import WarehousePicker from "../components/inventory/WarehousePicker";
import AddInventoryModal from "../components/inventory/AddInventoryModal";
import {
  LocationKey,
  LocationSegments,
  WarehouseColorProvider,
  WarehouseLegend,
  isSplit,
} from "../components/inventory/locationShades";
import { useAuthStore } from "../stores/authStore";
import { inventoryService } from "../services/InventoryService";
import {
  InventoryMapper,
  BYPRODUCT_NAMES,
  INVENTORY_SORTS,
  isInventorySort,
  type UnifiedItem,
} from "../mappers/InventoryMapper";
import { useInventorySort } from "../hooks/useInventorySort";
import { useReorderableTabs } from "../hooks/useReorderableTabs";
import Select from "../components/Select";

type ViewMode = "classic" | "spreadsheet" | "cards" | "bins" | "warehouse";

const TYPE_COLORS: Record<
  UnifiedItem["type"],
  { fill: string; ring: string; bar: string; text: string }
> = {
  palay: {
    fill: "bg-amber-100 dark:bg-amber-950/40",
    ring: "ring-amber-300/60",
    bar: "bg-amber-500",
    text: "text-amber-700 dark:text-amber-300",
  },
  milled: {
    fill: "bg-emerald-100 dark:bg-emerald-950/40",
    ring: "ring-emerald-300/60",
    bar: "bg-emerald-500",
    text: "text-emerald-700 dark:text-emerald-300",
  },
  byproduct: {
    fill: "bg-slate-100 dark:bg-slate-800/60",
    ring: "ring-slate-300/60",
    bar: "bg-slate-500",
    text: "text-slate-700 dark:text-slate-300",
  },
};

// The tabs as first shown; each account can drag them into its own order.
const VIEWS: { key: ViewMode; label: string; icon: React.ElementType }[] = [
  { key: "cards", label: "Cards", icon: LayoutGrid },
  { key: "bins", label: "Bins", icon: BarChart3 },
  { key: "warehouse", label: "Warehouse", icon: Warehouse },
  { key: "classic", label: "Classic", icon: List },
  { key: "spreadsheet", label: "Spreadsheet", icon: Table2 },
];

export default function InventoryPage() {
  const [branchFilter, setBranchFilter] = useState<string>("");
  // The tabs can be dragged into any order, remembered per account. The page
  // opens on whichever one is first.
  const tabs = useReorderableTabs(
    "rice-mill-inventory-tabs",
    VIEWS.map((v) => v.key),
  );
  const orderedViews = tabs.order
    .map((key) => VIEWS.find((v) => v.key === key))
    .filter((v): v is (typeof VIEWS)[number] => !!v);
  const [view, setView] = useState<ViewMode>(() => orderedViews[0]?.key ?? "cards");
  const [selected, setSelected] = useState<UnifiedItem | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  // Adding stock is an owner/admin action — mirrors the backend role gate so we
  // don't dangle a button that would just 403. The button sits in the page
  // header, so it's available on every view tab.
  const role = useAuthStore((s) => s.user?.role);
  const canAddInventory = role === "owner" || role === "admin";

  const { data: branches = [] } = useQuery<any[]>({
    queryKey: ["branches"],
    queryFn: () => inventoryService.getBranches(),
  });
  const { data: milled = [] } = useQuery<any[]>({
    queryKey: ["milled-rice", branchFilter],
    queryFn: () => inventoryService.getMilledRice(branchFilter),
  });
  const { data: byproducts = [] } = useQuery<any[]>({
    queryKey: ["byproducts", branchFilter],
    queryFn: () => inventoryService.getByproducts(branchFilter),
  });
  const { data: palay = [] } = useQuery<any[]>({
    queryKey: ["palay-inventory", branchFilter],
    queryFn: () => inventoryService.getPalay(branchFilter),
  });
  const { data: summary } = useQuery<any>({
    queryKey: ["inventory-summary", branchFilter],
    queryFn: () => inventoryService.getSummary(branchFilter),
  });

  // Every view lists stock in the order this account chose (remembered between
  // visits, even after signing out). With "All warehouses" picked, one variety
  // and grade held in several warehouses shows once, with its total; each view
  // still shows how that total splits between the warehouses.
  const [sort, setSort] = useInventorySort();
  const items: UnifiedItem[] = useMemo(() => {
    const unified = InventoryMapper.toUnifiedItems(palay, milled, byproducts);
    const shown = branchFilter ? unified : InventoryMapper.combineAcrossWarehouses(unified);
    return shown.sort(InventoryMapper.comparator(sort));
  }, [palay, milled, byproducts, sort, branchFilter]);
  const palaySorted = useMemo(() => InventoryMapper.sortRows(palay, "palay", sort), [palay, sort]);
  const milledSorted = useMemo(
    () => InventoryMapper.sortRows(milled, "milled", sort),
    [milled, sort],
  );
  const byproductsSorted = useMemo(
    () => InventoryMapper.sortRows(byproducts, "byproduct", sort),
    [byproducts, sort],
  );

  const totalKg = items.reduce((s, i) => s + i.quantity_kg, 0);

  return (
    // Each warehouse keeps one colour on every view and in the detail window.
    <WarehouseColorProvider branches={branches}>
      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-primary">Inventory</h2>
            <p className="text-sm text-secondary">Stock of palay, milled rice, and by-products</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <WarehousePicker
              branches={branches as any[]}
              selectedId={branchFilter}
              onSelect={setBranchFilter}
            />
            <Select
              className="!w-auto min-w-[13rem]"
              aria-label="Sort inventory by"
              value={sort}
              onChange={(v) => isInventorySort(v) && setSort(v)}
              options={INVENTORY_SORTS}
            />
            {canAddInventory && (
              <button
                type="button"
                data-testid="add-inventory-btn"
                onClick={() => setShowAdd(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-grad-brand text-white text-sm font-semibold shadow-grad-glow hover:opacity-90 transition-opacity whitespace-nowrap"
              >
                <Plus size={15} /> Add inventory
              </button>
            )}
          </div>
        </div>

        {/* View switcher: drag a tab to rearrange (press and hold on a touch screen) */}
        <div
          {...tabs.containerProps}
          title="Drag a tab to rearrange. On a touch screen, press and hold first."
          className="flex items-center gap-1 p-1 rounded-xl glass overflow-x-auto"
        >
          {orderedViews.map(({ key, label, icon: Icon }) => {
            const active = view === key;
            const lifted = tabs.dragging === key;
            return (
              <button
                key={key}
                {...tabs.tabProps(key)}
                onClick={() => {
                  if (!tabs.wasDragged()) setView(key);
                }}
                className={`flex select-none items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold whitespace-nowrap transition-all [-webkit-touch-callout:none] ${
                  lifted ? "scale-105 cursor-grabbing shadow-lg ring-2 ring-emerald-400" : ""
                } ${
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

        {/* All warehouses: which colour is which warehouse; a click narrows to one */}
        {!branchFilter && (view === "cards" || view === "bins" || view === "spreadsheet") && (
          <WarehouseLegend items={items} onPick={setBranchFilter} />
        )}

        {view === "classic" && (
          <ClassicView
            palay={palaySorted}
            milled={milledSorted}
            byproducts={byproductsSorted}
            summary={summary}
            branchFilter={branchFilter}
          />
        )}
        {view === "spreadsheet" && <SpreadsheetView key={sort} items={items} />}
        {view === "cards" && <CardsView items={items} totalKg={totalKg} onSelect={setSelected} />}
        {view === "bins" && <BinsView items={items} onSelect={setSelected} />}
        {view === "warehouse" && (
          <NewWarehouseView
            branches={branches}
            branchFilter={branchFilter}
            setBranchFilter={setBranchFilter}
          />
        )}

        <InventoryDetailDrawer
          item={selected}
          totalKg={totalKg}
          onClose={() => setSelected(null)}
          onViewInWarehouse={(branchId) => {
            if (branchId) setBranchFilter(branchId);
            setView("warehouse");
            setSelected(null);
          }}
        />

        {showAdd && (
          <AddInventoryModal
            branches={branches as any[]}
            defaultBranchId={branchFilter}
            onClose={() => setShowAdd(false)}
          />
        )}
      </div>
    </WarehouseColorProvider>
  );
}

/** Stock mostly follows from purchases and milling; what a new mill already
 *  holds goes in once through "Add inventory". */
const EMPTY_INVENTORY =
  "Inventory is empty. Stock comes in as you record palay purchases and milling batches. Already have rice or palay in the warehouse? Enter it with Add inventory.";

/* ─── 1. CLASSIC ─── the original 3-column card list */

function ClassicView({ palay, milled, byproducts, summary, branchFilter }: any) {
  return (
    <>
      {summary?.by_branch && summary.by_branch.length > 0 && !branchFilter && (
        <div className="card">
          <h3 className="font-semibold text-primary mb-3">Stock by warehouse</h3>
          <div className="overflow-x-auto">
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
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <ClassicCard
          icon={<Wheat size={18} className="text-amber-500" />}
          title="Palay (Paddy) Stock"
          rows={palay}
          kind="palay"
          emptyText="No palay in stock. It arrives when you record a purchase on Paddy / Palay."
        />
        <ClassicCard
          icon={<Package size={18} className="text-emerald-500" />}
          title="Milled Rice (Bigas)"
          rows={milled}
          kind="milled"
          emptyText="No milled rice yet. It arrives when you record a milling batch."
        />
        <ClassicCard
          icon={<Package size={18} className="text-slate-500 dark:text-slate-400" />}
          title="By-products"
          rows={byproducts}
          kind="byproduct"
          emptyText="No by-products yet. Hull, bran and broken rice come from milling batches."
        />
      </div>
    </>
  );
}

function ClassicCard({
  icon,
  title,
  rows,
  kind,
  emptyText,
}: {
  icon: React.ReactNode;
  title: string;
  rows: any[];
  kind: "palay" | "milled" | "byproduct";
  emptyText: string;
}) {
  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-4">
        {icon}
        <h3 className="font-semibold text-primary">{title}</h3>
      </div>
      <div className="space-y-2">
        {rows.map((inv: any) => (
          <div
            key={inv.id}
            className="flex justify-between items-start py-1.5 border-b border-slate-100 dark:border-slate-800 last:border-0"
          >
            <div>
              {kind === "byproduct" ? (
                <span className="text-sm text-primary">
                  {BYPRODUCT_NAMES[inv.byproduct_type] || inv.byproduct_type}
                </span>
              ) : (
                <>
                  <span className="font-medium text-sm text-primary">
                    {inv.variety?.code || "Unknown"}
                  </span>
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
              <p className="font-semibold text-sm text-primary">
                {Number(inv.quantity_kg).toLocaleString()} kg
              </p>
              {kind !== "byproduct" && (
                <p className="text-xs text-muted">
                  {(Number(inv.quantity_kg) / 50).toFixed(1)} cavans
                </p>
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
  // Opens in the order chosen at the top of the page (items arrive sorted that
  // way); clicking a column header re-sorts on that column.
  const [sortKey, setSortKey] = useState<
    "grade" | "quantity_kg" | "typeLabel" | "variety" | "branchName" | null
  >(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    const rows = items.filter(
      (i) =>
        !q ||
        i.variety.toLowerCase().includes(q) ||
        i.branchName.toLowerCase().includes(q) ||
        (i.locations ?? []).some((l) => l.branchName.toLowerCase().includes(q)) ||
        i.typeLabel.toLowerCase().includes(q),
    );
    if (!sortKey) return rows;
    return rows.sort((a, b) => {
      if (sortKey === "grade")
        return sortDir === "asc" ? InventoryMapper.compare(a, b) : InventoryMapper.compare(b, a);
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === "number" && typeof bv === "number")
        return sortDir === "asc" ? av - bv : bv - av;
      return sortDir === "asc"
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av));
    });
  }, [items, search, sortKey, sortDir]);

  const toggleSort = (k: NonNullable<typeof sortKey>) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir("desc");
    }
  };

  const TH = (key: NonNullable<typeof sortKey>, label: string) => (
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
        <span className="ml-auto text-xs text-muted">
          {filtered.length} of {items.length} rows
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-700">
            <tr>
              {TH("typeLabel", "Type")}
              {TH("variety", "Variety / Item")}
              {TH("grade", "Grade")}
              {TH("branchName", "Warehouse")}
              {TH("quantity_kg", "Quantity (kg)")}
              <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Cavans (50kg)
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {filtered.map((i) => {
              const c = TYPE_COLORS[i.type];
              return (
                <tr key={i.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="px-4 py-2.5">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-bold ${c.fill} ${c.text} ring-1 ${c.ring}`}
                    >
                      {i.typeLabel}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 font-medium text-primary">{i.variety}</td>
                  <td className="px-4 py-2.5 text-secondary">{i.grade}</td>
                  <td className="px-4 py-2.5 text-secondary">
                    {isSplit(i) ? <LocationKey item={i} all /> : i.branchName}
                  </td>
                  <td className="px-4 py-2.5 font-semibold text-primary">
                    {i.quantity_kg.toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5 text-right text-muted">
                    {(i.quantity_kg / 50).toFixed(1)}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-muted">
                  No matching items.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// The three kinds of stock, in the order the Cards and Bins views list them.
const INVENTORY_SECTIONS: { type: UnifiedItem["type"]; label: string; icon: React.ReactNode }[] = [
  { type: "palay", label: "Palay (Paddy)", icon: <Wheat size={16} className="text-amber-500" /> },
  {
    type: "milled",
    label: "Milled Rice (Bigas)",
    icon: <Package size={16} className="text-emerald-500" />,
  },
  {
    type: "byproduct",
    label: "By-products",
    icon: <Package size={16} className="text-slate-500 dark:text-slate-400" />,
  },
];

/* ─── 3. CARDS ─── modern card grid with progress against total */
const TYPE_ICON_BY_KIND: Record<UnifiedItem["type"], React.ElementType> = {
  palay: Wheat,
  milled: Package,
  byproduct: Package,
};

const TYPE_BAR_GRAD: Record<UnifiedItem["type"], string> = {
  palay: "from-amber-500 to-orange-400",
  milled: "from-emerald-500 to-teal-400",
  byproduct: "from-slate-500 to-slate-400",
};

function CardsView({
  items,
  totalKg,
  onSelect,
}: {
  items: UnifiedItem[];
  totalKg: number;
  onSelect: (item: UnifiedItem) => void;
}) {
  // Items arrive in the order chosen at the top of the page; grouping keeps it.
  const grouped = useMemo(() => {
    const g: Record<UnifiedItem["type"], UnifiedItem[]> = { palay: [], milled: [], byproduct: [] };
    items.forEach((i) => g[i.type].push(i));
    return g;
  }, [items]);

  if (items.length === 0) {
    return <div className="card text-sm text-secondary text-center py-10">{EMPTY_INVENTORY}</div>;
  }

  return (
    <div className="space-y-5">
      {INVENTORY_SECTIONS.map(({ type, label, icon }) => {
        const list = grouped[type];
        const c = TYPE_COLORS[type];
        const Icon = TYPE_ICON_BY_KIND[type];
        const grad = TYPE_BAR_GRAD[type];
        const sectionTotal = list.reduce((s, x) => s + x.quantity_kg, 0);

        return (
          // Each kind is its own lane, so the three rows read as separate.
          <section
            key={type}
            data-testid={`cards-section-${type}`}
            className="rounded-2xl bg-slate-50/60 p-4 ring-1 ring-slate-200/80 dark:bg-slate-900/30 dark:ring-slate-700/60"
          >
            <div className="flex items-center gap-2 mb-1.5">
              {icon}
              <h3 className="font-semibold text-primary">{label}</h3>
              <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] font-semibold text-secondary bg-white dark:bg-slate-800/60 ring-1 ring-slate-200/80 dark:ring-slate-700 px-2 py-0.5 rounded-md tabular-nums">
                {list.length} item{list.length === 1 ? "" : "s"}
                {list.length > 0 && (
                  <>
                    <span className="text-muted">·</span>
                    {sectionTotal.toLocaleString()} kg
                  </>
                )}
              </span>
            </div>
            <div className={`h-px w-full ${SECTION_UNDERLINE[type]} opacity-60 mb-3`} aria-hidden />

            {list.length === 0 ? (
              <p className="text-sm text-muted italic py-3 px-1">{SECTION_EMPTY[type]}</p>
            ) : (
              // One row per kind: the cards sit side by side and the row scrolls sideways.
              <div
                data-testid={`cards-row-${type}`}
                className="-mx-1 flex snap-x snap-proximity gap-4 overflow-x-auto px-1 pb-3 pt-1 [scrollbar-width:thin]"
              >
                {list.map((i, idx) => {
                  const pct = totalKg > 0 ? (i.quantity_kg / totalKg) * 100 : 0;
                  const cavans = i.quantity_kg / 50;
                  const isStaggered = idx < 8;
                  return (
                    <button
                      key={i.id}
                      type="button"
                      data-testid="inventory-card"
                      onClick={() => onSelect(i)}
                      className={`group card !p-5 w-64 shrink-0 snap-start ring-1 ${c.ring} text-left cursor-pointer transition-transform duration-150 hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 sm:w-72 ${isStaggered ? "animate-grad-fade-up" : ""}`}
                      style={isStaggered ? { animationDelay: `${idx * 30}ms` } : undefined}
                    >
                      {/* Header: dot + type label, pct chip */}
                      <div className="flex items-center justify-between mb-3.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className={`shrink-0 w-2.5 h-2.5 rounded-full ${c.bar} shadow-[0_0_0_3px_rgba(255,255,255,0.4)]`}
                            aria-hidden
                          />
                          <span
                            className={`text-[10px] font-bold uppercase tracking-[0.08em] truncate ${c.text}`}
                          >
                            {i.typeLabel}
                          </span>
                        </div>
                        <span className="shrink-0 text-[10px] font-semibold text-muted tabular-nums bg-slate-100/60 dark:bg-slate-700/40 px-1.5 py-0.5 rounded-md">
                          {pct.toFixed(1)}%
                        </span>
                      </div>

                      {/* Title row: icon + variety */}
                      <div className="flex items-start gap-2">
                        <Icon size={18} className={`mt-0.5 shrink-0 ${c.text}`} />
                        <div className="min-w-0">
                          <p className="font-bold text-lg text-primary leading-tight truncate">
                            {i.variety}
                          </p>
                          <p className="text-xs text-muted mt-0.5">
                            Grade <span className="font-semibold text-secondary">{i.grade}</span>
                          </p>
                        </div>
                      </div>

                      {/* Quantity hero */}
                      <div className="mt-4">
                        <p className="text-[26px] font-extrabold text-primary tabular-nums leading-none">
                          {i.quantity_kg.toLocaleString()}
                          <span className="text-sm font-medium text-muted ml-1">kg</span>
                        </p>
                        <p className="text-xs text-muted mt-1 tabular-nums">
                          {cavans.toFixed(1)} cavans
                        </p>
                      </div>

                      {/* Progress bar: track + fill */}
                      <div className="mt-3 h-1.5 w-full bg-slate-200/70 dark:bg-slate-700/60 rounded-full overflow-hidden">
                        <div
                          role="progressbar"
                          aria-valuenow={Math.round(pct)}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-label={`${pct.toFixed(1)}% of total stock`}
                          className={`h-full transition-[width] duration-500 ${isSplit(i) ? "" : `bg-gradient-to-r ${grad}`}`}
                          style={{ width: `${Math.max(pct, 1.5)}%` }}
                        >
                          {isSplit(i) && <LocationSegments item={i} />}
                        </div>
                      </div>

                      {/* Held in several warehouses: which one holds how much */}
                      {isSplit(i) && <LocationKey item={i} className="mt-3" />}

                      {/* Footer: warehouse chip + drill-in hint */}
                      <div className="mt-3.5 flex items-center justify-between">
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-secondary bg-slate-100/70 dark:bg-slate-800/50 px-2 py-1 rounded-md max-w-[78%] truncate">
                          <Building2 size={11} className="shrink-0 text-muted" />
                          <span className="truncate">{i.branchName}</span>
                        </span>
                        <ArrowRight
                          size={14}
                          className="text-muted opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all"
                        />
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

/* ─── 4. BINS ─── horizontal bar chart, items as labeled bars */
const SECTION_UNDERLINE: Record<UnifiedItem["type"], string> = {
  palay: "bg-gradient-to-r from-amber-500 via-orange-400 to-transparent",
  milled: "bg-gradient-to-r from-emerald-500 via-teal-400 to-transparent",
  byproduct: "bg-gradient-to-r from-slate-500 via-slate-400 to-transparent",
};

const SECTION_EMPTY: Record<UnifiedItem["type"], string> = {
  palay: "No palay in stock",
  milled: "No milled rice in stock",
  byproduct: "No by-products on hand",
};

function BinsView({
  items,
  onSelect,
}: {
  items: UnifiedItem[];
  onSelect: (item: UnifiedItem) => void;
}) {
  const grouped = useMemo(() => {
    const g: Record<UnifiedItem["type"], UnifiedItem[]> = { palay: [], milled: [], byproduct: [] };
    items.forEach((i) => g[i.type].push(i));
    return g;
  }, [items]);

  if (items.length === 0) {
    return <div className="card text-sm text-secondary text-center py-10">{EMPTY_INVENTORY}</div>;
  }

  return (
    <div className="space-y-6">
      {INVENTORY_SECTIONS.map(({ type, label, icon }) => {
        const list = grouped[type];
        const c = TYPE_COLORS[type];
        const grad = TYPE_BAR_GRAD[type];
        const sectionTotal = list.reduce((s, x) => s + x.quantity_kg, 0);
        const sectionMax = Math.max(...list.map((x) => x.quantity_kg), 1);

        return (
          <section key={type} data-testid={`bins-section-${type}`} className="card">
            <div className="flex items-center gap-2 mb-1.5">
              {icon}
              <h3 className="font-semibold text-primary">{label}</h3>
              <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] font-semibold text-secondary bg-slate-100 dark:bg-slate-800/60 ring-1 ring-slate-200/80 dark:ring-slate-700 px-2 py-0.5 rounded-md tabular-nums">
                {list.length} bin{list.length === 1 ? "" : "s"}
                {list.length > 0 && (
                  <>
                    <span className="text-muted">·</span>
                    {sectionTotal.toLocaleString()} kg
                  </>
                )}
              </span>
            </div>
            <div className={`h-px w-full ${SECTION_UNDERLINE[type]} opacity-60 mb-4`} aria-hidden />

            {list.length === 0 ? (
              <p className="text-sm text-muted italic py-3 px-1">{SECTION_EMPTY[type]}</p>
            ) : (
              <div className="space-y-3">
                {list.map((i) => {
                  const w = (i.quantity_kg / sectionMax) * 100;
                  const sectionPct = sectionTotal > 0 ? (i.quantity_kg / sectionTotal) * 100 : 0;
                  return (
                    <button
                      key={i.id}
                      type="button"
                      data-testid="inventory-bin-row"
                      onClick={() => onSelect(i)}
                      className="group block w-full text-left rounded-lg px-2 -mx-2 py-2 transition-colors hover:bg-slate-100/60 dark:hover:bg-slate-800/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                    >
                      <div className="flex items-end justify-between gap-3 mb-1.5">
                        <div className="min-w-0">
                          <span className="font-semibold text-primary text-sm truncate block">
                            {i.variety}
                          </span>
                          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                            <span
                              className={`inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded ${c.fill} ${c.text}`}
                            >
                              {i.grade}
                            </span>
                            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-muted bg-slate-100 dark:bg-slate-800/60 px-1.5 py-0.5 rounded">
                              <Building2 size={9} /> {i.branchName}
                            </span>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="font-bold text-sm text-primary tabular-nums leading-none">
                            {i.quantity_kg.toLocaleString()}{" "}
                            <span className="text-xs font-medium text-muted">kg</span>
                          </p>
                          <p className="text-[10px] text-muted tabular-nums mt-0.5">
                            {(i.quantity_kg / 50).toFixed(0)} cavans · {sectionPct.toFixed(1)}%
                          </p>
                        </div>
                      </div>
                      <div className="relative h-2 w-full bg-slate-100 dark:bg-slate-800/80 rounded-full overflow-hidden ring-1 ring-inset ring-slate-200/70 dark:ring-slate-700/60">
                        <div
                          role="progressbar"
                          aria-valuenow={Math.round(sectionPct)}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          className={`h-full transition-[width,filter] duration-500 group-hover:brightness-110 ${isSplit(i) ? "" : `bg-gradient-to-r ${grad}`}`}
                          style={{ width: `${Math.max(w, 2)}%` }}
                        >
                          {isSplit(i) && <LocationSegments item={i} />}
                        </div>
                      </div>
                      {isSplit(i) && <LocationKey item={i} max={6} inline className="mt-1.5" />}
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

/* ─── 5. WAREHOUSE ─── components/warehouse/NewWarehouseView; this is its plan upsell */
export function CanvaUpsellCard() {
  return (
    <div className="rounded-2xl overflow-hidden ring-1 ring-slate-200 dark:ring-slate-700 bg-gradient-to-br from-indigo-50 via-violet-50 to-fuchsia-50 dark:from-indigo-950/40 dark:via-violet-950/30 dark:to-fuchsia-950/30 p-8 text-center">
      <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-white/80 dark:bg-slate-800/80 shadow-sm ring-1 ring-slate-200 dark:ring-slate-700 mb-4">
        <Lock size={22} className="text-indigo-500" />
      </div>
      <h3 className="text-xl font-bold text-primary mb-1.5">
        <Sparkles size={16} className="inline -mt-0.5 mr-1 text-amber-500" />
        Visual Warehouse Canva — a Pro feature
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
