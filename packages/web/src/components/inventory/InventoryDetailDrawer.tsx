import { useEffect, useRef } from "react";
import {
  X as XIcon, Wheat, Package, Building2, ArrowRight, Warehouse,
  Scale, Layers, Percent,
} from "lucide-react";

export type DrawerItem = {
  id: string;
  type: "palay" | "milled" | "byproduct";
  typeLabel: string;
  variety: string;
  grade: string;
  branchId: string | null;
  branchName: string;
  quantity_kg: number;
};

type Props = {
  item: DrawerItem | null;
  totalKg: number;
  onClose: () => void;
  onViewInWarehouse?: (branchId: string | null) => void;
};

const TYPE_THEME: Record<DrawerItem["type"], { dot: string; bar: string; accent: string; soft: string }> = {
  palay:     { dot: "bg-amber-500",    bar: "from-amber-500 to-orange-400",       accent: "text-amber-600 dark:text-amber-300",     soft: "bg-amber-50 dark:bg-amber-950/30" },
  milled:    { dot: "bg-emerald-500",  bar: "from-emerald-500 to-teal-400",       accent: "text-emerald-600 dark:text-emerald-300", soft: "bg-emerald-50 dark:bg-emerald-950/30" },
  byproduct: { dot: "bg-slate-500",    bar: "from-slate-500 to-slate-400",        accent: "text-slate-600 dark:text-slate-300",     soft: "bg-slate-50 dark:bg-slate-800/40" },
};

const TYPE_ICON: Record<DrawerItem["type"], React.ElementType> = {
  palay: Wheat,
  milled: Package,
  byproduct: Package,
};

export default function InventoryDetailDrawer({ item, totalKg, onClose, onViewInWarehouse }: Props) {
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!item) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    closeBtnRef.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [item, onClose]);

  if (!item) return null;

  const theme = TYPE_THEME[item.type];
  const Icon = TYPE_ICON[item.type];
  const pct = totalKg > 0 ? (item.quantity_kg / totalKg) * 100 : 0;
  const cavans = item.quantity_kg / 50;

  return (
    <div
      className="fixed inset-0 z-50 flex"
      role="dialog"
      aria-modal="true"
      aria-labelledby="inventory-drawer-title"
    >
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close drawer"
        onClick={onClose}
        className="absolute inset-0 bg-slate-900/45 backdrop-blur-sm animate-grad-fade-up"
        style={{ animationDuration: "180ms" }}
      />

      {/* Panel — right-anchored */}
      <aside
        className="relative ml-auto h-full w-full max-w-md glass-strong shadow-2xl flex flex-col animate-panel-in"
        data-testid="inventory-drawer"
      >
        {/* Header */}
        <header className="flex items-start justify-between gap-3 p-5 border-b border-soft">
          <div className="flex items-start gap-3 min-w-0">
            <span className={`shrink-0 inline-flex items-center justify-center w-10 h-10 rounded-xl ${theme.soft} ring-1 ring-inset ring-black/5 dark:ring-white/5`}>
              <Icon size={20} className={theme.accent} />
            </span>
            <div className="min-w-0">
              <p className={`text-[10px] font-bold uppercase tracking-[0.08em] ${theme.accent}`}>
                {item.typeLabel}
              </p>
              <h2
                id="inventory-drawer-title"
                className="text-xl font-bold text-primary leading-tight truncate"
              >
                {item.variety}
              </h2>
              <p className="text-xs text-muted mt-0.5">Grade <span className="font-semibold text-secondary">{item.grade}</span></p>
            </div>
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            className="btn-ghost !p-1.5 shrink-0"
            aria-label="Close"
          >
            <XIcon size={18} />
          </button>
        </header>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Hero quantity */}
          <div className="rounded-2xl p-5 bg-gradient-to-br from-slate-50 to-white dark:from-slate-800/60 dark:to-slate-900/40 ring-1 ring-soft">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted">On hand</p>
            <p className="mt-1 text-4xl font-extrabold text-primary tabular-nums leading-none">
              {item.quantity_kg.toLocaleString()}
              <span className="text-base font-medium text-muted ml-1.5">kg</span>
            </p>
            <div className={`mt-3 h-2 rounded-full bg-slate-200/70 dark:bg-slate-700/60 overflow-hidden`}>
              <div
                role="progressbar"
                aria-valuenow={Math.round(pct)}
                aria-valuemin={0}
                aria-valuemax={100}
                className={`h-full bg-gradient-to-r ${theme.bar} transition-[width] duration-500`}
                style={{ width: `${Math.max(pct, 1.5)}%` }}
              />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
              <div className="flex items-center gap-1.5 text-muted">
                <Layers size={12} />
                <span className="tabular-nums font-semibold text-secondary">{cavans.toFixed(1)}</span>
                <span>cavans</span>
              </div>
              <div className="flex items-center gap-1.5 text-muted justify-end">
                <Percent size={12} />
                <span className="tabular-nums font-semibold text-secondary">{pct.toFixed(2)}%</span>
                <span>of total stock</span>
              </div>
            </div>
          </div>

          {/* Pack-out calculator — only meaningful for sackable stock (palay + milled) */}
          {item.type !== "byproduct" && (
            <div data-testid="pack-out-calculator" className="rounded-2xl ring-1 ring-soft overflow-hidden">
              <div className="px-4 py-2.5 bg-slate-50 dark:bg-slate-800/40 border-b border-soft">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted">Pack-out estimate</p>
              </div>
              <div className="grid grid-cols-2 divide-x divide-soft">
                {[
                  { kg: 50, label: "50 kg sacks" },
                  { kg: 25, label: "25 kg sacks" },
                ].map(({ kg, label }) => {
                  const full = Math.floor(item.quantity_kg / kg);
                  const leftover = +(item.quantity_kg - full * kg).toFixed(2);
                  return (
                    <div key={kg} className="px-4 py-3 text-center bg-white/30 dark:bg-slate-800/30">
                      <p className="text-2xl font-extrabold text-primary tabular-nums leading-none">
                        {full.toLocaleString()}
                        <span className="text-xs font-medium text-muted ml-1">sacks</span>
                      </p>
                      <p className="text-[11px] text-muted mt-1 font-medium">{label}</p>
                      {leftover > 0 && (
                        <p className="text-[10px] text-muted mt-0.5 tabular-nums">
                          + {leftover} kg loose
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Meta rows */}
          <dl className="rounded-2xl ring-1 ring-soft overflow-hidden divide-y divide-soft text-sm">
            <div className="flex items-center justify-between gap-3 px-4 py-3 bg-white/30 dark:bg-slate-800/30">
              <dt className="flex items-center gap-2 text-muted">
                <Building2 size={14} /> Warehouse
              </dt>
              <dd className="font-semibold text-primary truncate text-right">{item.branchName}</dd>
            </div>
            <div className="flex items-center justify-between gap-3 px-4 py-3 bg-white/30 dark:bg-slate-800/30">
              <dt className="flex items-center gap-2 text-muted">
                <Scale size={14} /> Unit weight
              </dt>
              <dd className="font-semibold text-primary">50 kg / cavan</dd>
            </div>
            <div className="flex items-center justify-between gap-3 px-4 py-3 bg-white/30 dark:bg-slate-800/30">
              <dt className="flex items-center gap-2 text-muted">
                <Package size={14} /> Item type
              </dt>
              <dd className="font-semibold text-primary">{item.typeLabel}</dd>
            </div>
          </dl>

          <p className="text-[11px] text-muted leading-relaxed px-1">
            Recent movements coming soon. For lot-level history, open the Warehouse view and select this stack.
          </p>
        </div>

        {/* Footer actions */}
        <footer className="p-4 border-t border-soft flex items-center gap-2">
          {onViewInWarehouse && item.branchId && (
            <button
              type="button"
              onClick={() => onViewInWarehouse(item.branchId)}
              className="btn-primary flex-1 !py-2"
            >
              <Warehouse size={15} />
              Open in Warehouse
              <ArrowRight size={14} className="ml-0.5" />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="btn-secondary !py-2"
          >
            Close
          </button>
        </footer>
      </aside>
    </div>
  );
}
