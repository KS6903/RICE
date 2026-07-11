import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Boxes,
  Layers,
  ChevronDown,
  Search,
  Package,
  AlertTriangle,
  Warehouse,
  Building2,
  Weight,
  Zap,
  Download,
  X as XIcon,
  Loader2,
  ArrowDownToLine,
  Calendar,
  Droplets,
} from "lucide-react";
import { canvaService } from "../../services/CanvaService";
import { useFeature } from "../../hooks/useFeature";
import { CanvaUpsellCard } from "../../pages/InventoryPage";
import { encodeCsvRow } from "../../utils/csv";
import {
  useRackView,
  type Rack,
  type RackPallet,
  type RackBatch,
  type AgingCounts,
} from "./useRackView";

/* ─── New Warehouse: a structured rack/grid alternative to the spatial canva.
   Same warehouse data, grouped by zone as scannable "racks" with occupancy bars,
   oldest-first pallet lists, search, filters, sort, FIFO dispatch helper, a
   pallet detail panel, and CSV export. No dragging. ── */

type AgingFilter = "all" | "fresh" | "warning" | "critical" | "expired";
type SortKey = "oldest" | "newest" | "heaviest" | "fullest";

const AGING_META: Record<
  RackPallet["aging_status"],
  { dot: string; badge: string; label: string }
> = {
  fresh: { dot: "bg-emerald-500", badge: "badge-green", label: "Fresh" },
  warning: { dot: "bg-amber-500", badge: "badge-yellow", label: "Warning" },
  critical: { dot: "bg-rose-500", badge: "badge-red", label: "Critical" },
  expired: { dot: "bg-red-900", badge: "badge-gray", label: "Expired" },
};

const fmtKg = (n: number) => `${Math.round(n).toLocaleString()} kg`;

export default function NewWarehouseView({
  branches,
  branchFilter,
}: {
  branches: any[];
  branchFilter: string;
  setBranchFilter: (id: string) => void;
}) {
  const hasCanva = useFeature("canva_inventory");
  const activeBranchId = branchFilter || branches[0]?.id;
  const { data, isLoading, isError } = useRackView(activeBranchId);

  const [query, setQuery] = useState("");
  const [variety, setVariety] = useState("all");
  const [aging, setAging] = useState<AgingFilter>("all");
  const [sort, setSort] = useState<SortKey>("oldest");
  const [selected, setSelected] = useState<{ pallet: RackPallet; rackName: string } | null>(null);
  const [highlighted, setHighlighted] = useState<Set<string>>(new Set());
  const [showFifo, setShowFifo] = useState(false);

  // Distinct varieties across every rack + unzoned, for the filter dropdown.
  const varieties = useMemo(() => {
    if (!data) return [];
    const seen = new Set<string>();
    const all = [...data.racks.flatMap((r) => r.pallets), ...data.unzoned];
    for (const p of all) if (p.variety_code) seen.add(p.variety_code);
    return [...seen].sort();
  }, [data]);

  const matchPallet = (p: RackPallet) => {
    if (aging !== "all" && p.aging_status !== aging) return false;
    if (variety !== "all" && p.variety_code !== variety) return false;
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      const hay =
        `${p.pallet_code} ${p.variety_code ?? ""} ${p.variety_name ?? ""} ${p.client_name ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  };

  const sortPallets = (rows: RackPallet[]) => {
    const out = [...rows];
    if (sort === "newest") out.sort((a, b) => a.days_old - b.days_old);
    else if (sort === "heaviest") out.sort((a, b) => b.weight_kg - a.weight_kg);
    else out.sort((a, b) => b.days_old - a.days_old); // oldest (and "fullest" keeps oldest-first within rack)
    return out;
  };

  if (!hasCanva) return <CanvaUpsellCard />;

  if (!activeBranchId) {
    return (
      <div className="card text-center py-12" data-testid="new-warehouse-no-branch">
        <Building2 size={26} className="mx-auto text-slate-400 mb-3" />
        <p className="text-sm text-secondary">
          No warehouse selected. Create a branch first in Settings.
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-4" data-testid="new-warehouse-loading">
        <div className="h-24 rounded-2xl glass animate-pulse" />
        <div className="h-40 rounded-2xl glass animate-pulse" />
        <div className="h-40 rounded-2xl glass animate-pulse" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="card text-center py-12" data-testid="new-warehouse-error">
        <AlertTriangle size={26} className="mx-auto text-rose-500 mb-3" />
        <p className="text-sm text-secondary">Couldn't load the warehouse. Please try again.</p>
      </div>
    );
  }

  const empty = data.summary.total_pallets === 0;
  const noFilters = aging === "all" && variety === "all" && !query.trim();

  // Apply filters + per-rack sort; "fullest" reorders the racks themselves.
  let racksToShow = data.racks
    .map((r) => ({ ...r, pallets: sortPallets(r.pallets.filter(matchPallet)) }))
    .filter((r) => r.pallets.length > 0 || (r.pallet_count === 0 && noFilters));
  if (sort === "fullest") {
    racksToShow = [...racksToShow].sort(
      (a, b) => (b.occupancy_pct ?? -1) - (a.occupancy_pct ?? -1) || b.used_kg - a.used_kg,
    );
  }
  const unzonedToShow = sortPallets(data.unzoned.filter(matchPallet));

  // Flatten the currently-visible pallets (for CSV export), tagged with rack name.
  const visibleFlat: { pallet: RackPallet; rackName: string }[] = [
    ...racksToShow.flatMap((r) => r.pallets.map((p) => ({ pallet: p, rackName: r.name }))),
    ...unzonedToShow.map((p) => ({ pallet: p, rackName: "Unassigned" })),
  ];

  const exportCsv = () => {
    const header = [
      "pallet_code",
      "variety",
      "days_old",
      "weight_kg",
      "sacks",
      "client",
      "rack",
      "aging",
    ];
    const rows = visibleFlat.map(({ pallet: p, rackName }) =>
      encodeCsvRow([
        p.pallet_code,
        p.variety_name ?? p.variety_code ?? "",
        p.days_old,
        Math.round(p.weight_kg),
        p.sack_count,
        p.client_name ?? "",
        rackName,
        p.aging_status,
      ]),
    );
    const blob = new Blob([[header.join(","), ...rows].join("\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${data.layout.branch_name.replace(/\s+/g, "-").toLowerCase()}-pallets.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const applyFifo = (ids: string[]) => {
    setHighlighted(new Set(ids));
    setShowFifo(false);
  };

  return (
    <div className="space-y-5" data-testid="new-warehouse-view">
      {/* Summary header */}
      <div className="card relative overflow-hidden">
        <div className="absolute -top-12 -right-12 h-32 w-32 rounded-full bg-emerald-400/10 blur-2xl pointer-events-none" />
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="h-10 w-10 rounded-xl bg-grad-brand grid place-items-center shadow-grad-glow">
              <Boxes size={20} className="text-white" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-primary leading-tight">
                {data.layout.branch_name}
              </h3>
              <p className="text-xs text-muted">
                {data.layout.name} · {data.summary.total_pallets} pallets ·{" "}
                {fmtKg(data.summary.total_weight_kg)}
              </p>
            </div>
          </div>

          {data.summary.capacity_kg ? (
            <div className="min-w-[180px]">
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-muted font-semibold uppercase tracking-wide">Occupancy</span>
                <span className="text-primary font-bold tabular-nums">
                  {data.summary.occupancy_pct ?? 0}%
                </span>
              </div>
              <div className="h-2.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                <div
                  className="h-full bg-grad-brand rounded-full transition-all"
                  style={{ width: `${Math.min(100, data.summary.occupancy_pct ?? 0)}%` }}
                />
              </div>
              <p className="text-[10px] text-muted mt-1 tabular-nums">
                {fmtKg(data.summary.total_weight_kg)} / {fmtKg(data.summary.capacity_kg)}
              </p>
            </div>
          ) : null}

          <AgingChips counts={data.summary.by_aging} />
        </div>
      </div>

      {/* Toolbar: search + filters + sort + actions */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search
            size={15}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
          />
          <input
            className="input pl-9 w-full"
            style={{ paddingTop: "0.5rem", paddingBottom: "0.5rem" }}
            placeholder="Search pallet, variety, or client…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            data-testid="new-warehouse-search"
          />
        </div>
        <select
          className="input !py-2 !w-auto"
          value={variety}
          onChange={(e) => setVariety(e.target.value)}
          data-testid="new-warehouse-variety"
        >
          <option value="all">All varieties</option>
          {varieties.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
        <select
          className="input !py-2 !w-auto"
          value={aging}
          onChange={(e) => setAging(e.target.value as AgingFilter)}
          data-testid="new-warehouse-aging"
        >
          <option value="all">All ages</option>
          <option value="fresh">Fresh</option>
          <option value="warning">Warning</option>
          <option value="critical">Critical</option>
          <option value="expired">Expired</option>
        </select>
        <select
          className="input !py-2 !w-auto"
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          data-testid="new-warehouse-sort"
          title="Sort"
        >
          <option value="oldest">Oldest first</option>
          <option value="newest">Newest first</option>
          <option value="heaviest">Heaviest first</option>
          <option value="fullest">Fullest rack</option>
        </select>
        <button
          type="button"
          onClick={() => setShowFifo(true)}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-grad-brand text-white text-sm font-semibold shadow-grad-glow hover:opacity-90 transition-opacity"
          data-testid="new-warehouse-fifo"
        >
          <Zap size={15} /> Find oldest
        </button>
        <button
          type="button"
          onClick={exportCsv}
          disabled={visibleFlat.length === 0}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl glass text-secondary hover:text-primary text-sm font-semibold disabled:opacity-50 transition-colors"
          data-testid="new-warehouse-export"
          title="Export the visible pallets as CSV"
        >
          <Download size={15} /> Export
        </button>
      </div>

      {/* FIFO result banner */}
      {highlighted.size > 0 && (
        <div
          className="flex items-center gap-2 rounded-xl bg-amber-500/10 ring-1 ring-amber-500/30 px-4 py-2 text-sm"
          data-testid="new-warehouse-fifo-banner"
        >
          <Zap size={15} className="text-amber-500" />
          <span className="text-secondary font-medium">
            {highlighted.size} pallet{highlighted.size > 1 ? "s" : ""} highlighted for dispatch
            (oldest first).
          </span>
          <button
            type="button"
            onClick={() => setHighlighted(new Set())}
            className="ml-auto text-muted hover:text-primary"
            title="Clear highlight"
          >
            <XIcon size={15} />
          </button>
        </div>
      )}

      {/* Empty state */}
      {empty ? (
        <div data-testid="new-warehouse-empty-state" className="card text-center py-12">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-grad-brand flex items-center justify-center shadow-grad-glow mb-4">
            <Warehouse size={26} className="text-white" />
          </div>
          <h3 className="text-lg font-bold text-primary mb-1.5">
            No pallets in this warehouse yet
          </h3>
          <p className="text-sm text-secondary max-w-md mx-auto leading-relaxed">
            Stock pallets appear here once milling batches are recorded on the
            <span className="font-semibold"> Milling </span> page.
          </p>
        </div>
      ) : (
        <div className="space-y-3" data-testid="new-warehouse-racks">
          {racksToShow.map((rack) => (
            <RackCard
              key={rack.zone_id}
              rack={rack}
              highlighted={highlighted}
              onSelect={(p) => setSelected({ pallet: p, rackName: rack.name })}
            />
          ))}

          {unzonedToShow.length > 0 && (
            <RackCard
              rack={{
                zone_id: "__unzoned__",
                name: "Unassigned",
                zone_type: "unassigned",
                color_hex: "#94a3b8",
                capacity_kg: null,
                used_kg: unzonedToShow.reduce((s, p) => s + p.weight_kg, 0),
                occupancy_pct: null,
                pallet_count: unzonedToShow.length,
                by_aging: countAging(unzonedToShow),
                pallets: unzonedToShow,
              }}
              highlighted={highlighted}
              onSelect={(p) => setSelected({ pallet: p, rackName: "Unassigned" })}
            />
          )}

          {visibleFlat.length === 0 && (
            <div
              className="card text-center py-10 text-sm text-secondary"
              data-testid="new-warehouse-no-results"
            >
              No pallets match your filters.
            </div>
          )}
        </div>
      )}

      {selected && (
        <PalletDetailPanel
          pallet={selected.pallet}
          rackName={selected.rackName}
          onClose={() => setSelected(null)}
        />
      )}
      {showFifo && activeBranchId && (
        <FifoPanel
          branchId={activeBranchId}
          onClose={() => setShowFifo(false)}
          onApply={applyFifo}
        />
      )}
    </div>
  );
}

function countAging(pallets: RackPallet[]): AgingCounts {
  const out: AgingCounts = { fresh: 0, warning: 0, critical: 0, expired: 0 };
  for (const p of pallets) out[p.aging_status] += 1;
  return out;
}

function AgingChips({ counts }: { counts: AgingCounts }) {
  return (
    <div className="flex items-center gap-2.5">
      {(["fresh", "warning", "critical", "expired"] as const).map((k) => (
        <div key={k} className="flex items-center gap-1.5" title={AGING_META[k].label}>
          <span className={`w-2.5 h-2.5 rounded-full ${AGING_META[k].dot}`} />
          <span className="text-sm font-bold text-primary tabular-nums">{counts[k]}</span>
        </div>
      ))}
    </div>
  );
}

function RackCard({
  rack,
  highlighted,
  onSelect,
}: {
  rack: Rack;
  highlighted: Set<string>;
  onSelect: (p: RackPallet) => void;
}) {
  const hasHighlight = rack.pallets.some((p) => highlighted.has(p.id));
  const [open, setOpen] = useState(true);
  // Auto-expand a rack when one of its pallets gets highlighted by FIFO.
  useEffect(() => {
    if (hasHighlight) setOpen(true);
  }, [hasHighlight]);

  return (
    <div
      className={`card !p-0 overflow-hidden ${hasHighlight ? "ring-2 ring-amber-400/60" : ""}`}
      data-testid={`rack-${rack.zone_id}`}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors text-left"
      >
        <span className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: rack.color_hex }} />
        <div className="flex items-center gap-2 min-w-0">
          <Layers size={15} className="text-muted shrink-0" />
          <span className="font-semibold text-primary truncate">{rack.name}</span>
          <span className="badge-gray capitalize hidden sm:inline-flex">
            {rack.zone_type.replace(/_/g, " ")}
          </span>
        </div>

        <div className="ml-auto flex items-center gap-4">
          {rack.capacity_kg ? (
            <div className="hidden md:flex items-center gap-2 w-40">
              <div className="flex-1 h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                <div
                  className="h-full bg-grad-brand rounded-full"
                  style={{ width: `${Math.min(100, rack.occupancy_pct ?? 0)}%` }}
                />
              </div>
              <span className="text-xs text-muted tabular-nums w-9 text-right">
                {rack.occupancy_pct ?? 0}%
              </span>
            </div>
          ) : null}
          <span className="flex items-center gap-1.5 text-sm text-secondary tabular-nums">
            <Package size={14} className="text-muted" />
            {rack.pallets.length}
          </span>
          <AgingChips counts={rack.by_aging} />
          <ChevronDown
            size={16}
            className={`text-muted transition-transform ${open ? "rotate-180" : ""}`}
          />
        </div>
      </button>

      {open && (
        <div className="divide-y divide-soft border-t border-soft">
          {rack.pallets.length === 0 ? (
            <p className="px-4 py-4 text-sm text-muted italic">Empty rack.</p>
          ) : (
            rack.pallets.map((p) => (
              <PalletRow key={p.id} p={p} highlighted={highlighted.has(p.id)} onSelect={onSelect} />
            ))
          )}
        </div>
      )}
    </div>
  );
}

function PalletRow({
  p,
  highlighted,
  onSelect,
}: {
  p: RackPallet;
  highlighted: boolean;
  onSelect: (p: RackPallet) => void;
}) {
  const meta = AGING_META[p.aging_status];
  return (
    <button
      type="button"
      onClick={() => onSelect(p)}
      className={`w-full text-left flex items-center gap-3 px-4 py-2.5 transition-colors ${highlighted ? "bg-amber-500/10" : "hover:bg-slate-50/60 dark:hover:bg-slate-800/30"}`}
      data-testid={`pallet-${p.id}`}
    >
      <span className={`w-2 h-2 rounded-full shrink-0 ${meta.dot}`} />
      <span className="font-mono text-sm font-semibold text-primary w-32 shrink-0 truncate">
        {p.pallet_code}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-secondary truncate">
          {p.variety_name ?? p.variety_code ?? "—"}
          {p.client_name ? <span className="text-muted"> · {p.client_name}</span> : null}
        </p>
      </div>
      <span className="text-xs text-muted tabular-nums w-12 text-right shrink-0">
        {p.days_old}d
      </span>
      <span className="hidden sm:flex items-center gap-1 text-xs text-muted tabular-nums w-24 justify-end shrink-0">
        <Weight size={12} /> {fmtKg(p.weight_kg)}
      </span>
      <span className={`${meta.badge} shrink-0`}>{meta.label}</span>
    </button>
  );
}

/* ── Pallet detail slide-in panel ───────────────────────────────────────── */
function PalletDetailPanel({
  pallet,
  rackName,
  onClose,
}: {
  pallet: RackPallet;
  rackName: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const meta = AGING_META[pallet.aging_status];
  const batches = pallet.batches ?? [];
  return (
    <div className="fixed inset-0 z-50 flex" data-testid="pallet-detail-panel">
      <div
        className="flex-1 bg-slate-900/40 backdrop-blur-sm animate-grad-fade-up"
        onClick={onClose}
      />
      <div className="relative ml-auto h-full w-full max-w-md glass-strong shadow-2xl flex flex-col animate-panel-in">
        <div className="flex items-start justify-between gap-3 p-5 border-b border-soft">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full ${meta.dot}`} />
              <span className={meta.badge}>{meta.label}</span>
            </div>
            <h3 className="mt-1.5 font-mono text-lg font-bold text-primary truncate">
              {pallet.pallet_code}
            </h3>
            <p className="text-xs text-muted">
              {rackName} · {pallet.days_old} days old
            </p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 text-muted hover:text-primary p-1"
            title="Close"
            aria-label="Close"
          >
            <XIcon size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Total weight" value={fmtKg(pallet.weight_kg)} />
            <Stat label="Sacks" value={String(pallet.sack_count)} />
            <Stat label="Variety" value={pallet.variety_name ?? pallet.variety_code ?? "—"} />
            <Stat label="Client" value={pallet.client_name ?? "—"} />
          </div>

          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-muted mb-2">
              Batches ({batches.length})
            </p>
            <div className="space-y-2">
              {batches.length === 0 && (
                <p className="text-sm text-muted italic">No batch records.</p>
              )}
              {batches.map((b) => (
                <BatchRow key={b.id} b={b} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 ring-1 ring-soft px-3 py-2">
      <p className="text-[10px] font-bold uppercase tracking-wide text-muted">{label}</p>
      <p className="text-sm font-semibold text-primary truncate mt-0.5">{value}</p>
    </div>
  );
}

function BatchRow({ b }: { b: RackBatch }) {
  const meta = AGING_META[b.status];
  return (
    <div className="rounded-xl ring-1 ring-soft p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-primary truncate">
          {b.variety_name ?? b.variety_code ?? "—"}
          {b.grade_code ? <span className="text-muted font-normal"> · {b.grade_code}</span> : null}
        </span>
        <span className={meta.badge}>{meta.label}</span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        <span className="flex items-center gap-1">
          <Package size={12} /> {b.sack_count} sacks · {fmtKg(b.weight_kg)}
        </span>
        <span className="flex items-center gap-1">
          <Calendar size={12} /> milled {b.milling_date}
        </span>
        {b.moisture_pct != null && (
          <span className="flex items-center gap-1">
            <Droplets size={12} /> {b.moisture_pct}%
          </span>
        )}
        {b.best_before_date && <span>best before {b.best_before_date}</span>}
        {b.client_name && (
          <span>
            {b.client_name}
            {b.client_type ? ` (${b.client_type})` : ""}
          </span>
        )}
      </div>
    </div>
  );
}

/* ── FIFO dispatch helper ───────────────────────────────────────────────── */
type Variety = { id: string; code: string; name: string };
type Recommendation = {
  requested_kg: number;
  total_kg: number;
  shortfall_kg: number;
  pallet_ids: string[];
  pallets: {
    id: string;
    pallet_code: string;
    variety_code: string | null;
    milling_date: string;
    days_old: number;
    weight_kg: number;
    aging_status: string;
  }[];
};

function FifoPanel({
  branchId,
  onClose,
  onApply,
}: {
  branchId: string;
  onClose: () => void;
  onApply: (ids: string[]) => void;
}) {
  const [varietyId, setVarietyId] = useState("");
  const [weight, setWeight] = useState("1000");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const { data: varieties = [] } = useQuery<Variety[]>({
    queryKey: ["dispatch-varieties"],
    queryFn: () => canvaService.getVarietyOptions(),
  });

  const recommend = useMutation({
    mutationFn: (): Promise<Recommendation> =>
      canvaService.recommendFifo({
        variety_id: varietyId || null,
        weight_kg: Number(weight) || 0,
        branch_id: branchId,
      }),
  });
  const result = recommend.data;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-slate-900/60 backdrop-blur-sm p-4"
      data-testid="fifo-panel"
    >
      <div className="glass-strong rounded-2xl shadow-2xl ring-1 ring-soft p-6 w-[520px] max-w-full animate-grad-fade-up">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <Zap size={18} className="text-amber-500" />
            <h3 className="font-bold text-lg text-primary">Find oldest pallets (FIFO)</h3>
          </div>
          <button onClick={onClose} className="text-muted hover:text-primary" title="Close">
            <XIcon size={18} />
          </button>
        </div>
        <p className="text-sm text-secondary mb-5">
          Picks pallets oldest-first by milling date until the requested weight is covered, then
          highlights them in the list.
        </p>

        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wide text-muted mb-1">
              Variety
            </label>
            <select
              className="input"
              value={varietyId}
              onChange={(e) => setVarietyId(e.target.value)}
            >
              <option value="">Any variety</option>
              {varieties.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.code} — {v.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold uppercase tracking-wide text-muted mb-1">
              Weight needed (kg)
            </label>
            <input
              type="number"
              min="1"
              className="input"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
            />
          </div>
        </div>

        <button
          onClick={() => recommend.mutate()}
          disabled={recommend.isPending || !weight}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-grad-brand text-white text-sm font-semibold shadow-grad-glow hover:opacity-90 disabled:opacity-50"
        >
          {recommend.isPending ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Search size={14} />
          )}{" "}
          Find oldest pallets
        </button>

        {result && (
          <div className="mt-5 space-y-3">
            <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 ring-1 ring-soft p-3 text-sm flex items-baseline gap-3 flex-wrap">
              <span className="text-muted">Requested:</span>
              <span className="font-bold text-primary tabular-nums">
                {result.requested_kg.toLocaleString()} kg
              </span>
              <span className="text-muted">· Covered:</span>
              <span className="font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
                {result.total_kg.toLocaleString()} kg
              </span>
              {result.shortfall_kg > 0 && (
                <span className="font-bold text-rose-600 dark:text-rose-400 tabular-nums flex items-center gap-1">
                  <AlertTriangle size={12} /> short {result.shortfall_kg.toLocaleString()} kg
                </span>
              )}
            </div>

            {result.pallets.length === 0 ? (
              <p className="text-sm text-muted text-center py-4">No matching pallets in stock.</p>
            ) : (
              <div className="max-h-56 overflow-y-auto rounded-xl ring-1 ring-soft divide-y divide-soft">
                {result.pallets.map((p, i) => (
                  <div key={p.id} className="px-3 py-2 flex items-center gap-3 text-sm">
                    <span className="w-6 text-xs font-bold text-muted tabular-nums">{i + 1}.</span>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-primary">{p.pallet_code}</p>
                      <p className="text-xs text-muted">
                        {p.variety_code || "—"} · milled {p.milling_date} ({p.days_old}d old)
                      </p>
                    </div>
                    <p className="font-semibold text-primary tabular-nums shrink-0">
                      {p.weight_kg.toLocaleString()} kg
                    </p>
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="flex-1 px-4 py-2 rounded-xl ring-1 ring-soft text-sm font-semibold text-secondary hover:bg-slate-50 dark:hover:bg-slate-800/60"
              >
                Cancel
              </button>
              <button
                onClick={() => onApply(result.pallet_ids)}
                disabled={result.pallets.length === 0}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50"
              >
                <ArrowDownToLine size={14} /> Highlight in list
              </button>
            </div>
          </div>
        )}

        {recommend.isError && (
          <div className="mt-3 rounded-lg bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300 text-sm px-3 py-2 ring-1 ring-rose-200 dark:ring-rose-800/50">
            Failed to fetch recommendation.
          </div>
        )}
      </div>
    </div>
  );
}
