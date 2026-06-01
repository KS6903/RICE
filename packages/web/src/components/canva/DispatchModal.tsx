import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import api from "../../services/api";
import { Loader2, X as XIcon, ArrowDownToLine, Search, AlertTriangle } from "lucide-react";

type Variety = { id: string; code: string; name: string };

type Recommendation = {
  requested_kg: number;
  total_kg: number;
  shortfall_kg: number;
  variety_id: string | null;
  pallet_ids: string[];
  pallets: {
    id: string; pallet_code: string; variety_code: string | null;
    milling_date: string; days_old: number; weight_kg: number;
    sack_count: number; aging_status: string;
  }[];
};

export function DispatchModal({
  branchId, onClose, onApply,
}: {
  branchId: string;
  onClose: () => void;
  onApply: (palletIds: string[]) => void;
}) {
  const [varietyId, setVarietyId] = useState<string>("");
  const [weight, setWeight] = useState<string>("1000");

  const { data: varieties = [] } = useQuery<Variety[]>({
    queryKey: ["dispatch-varieties"],
    queryFn: () => api.get("/dispatch/variety-options").then(r => r.data),
  });

  const recommend = useMutation({
    mutationFn: (): Promise<Recommendation> =>
      api.post("/dispatch/recommend", {
        variety_id: varietyId || null,
        weight_kg: Number(weight) || 0,
        branch_id: branchId,
      }).then(r => r.data),
  });

  const result = recommend.data;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/60 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl ring-1 ring-slate-200 dark:ring-slate-700 p-6 w-[520px] max-w-[94vw]">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <ArrowDownToLine size={18} className="text-sky-500" />
            <h3 className="font-bold text-lg text-primary">FIFO Dispatch — find oldest pallets</h3>
          </div>
          <button onClick={onClose} className="text-muted hover:text-primary" title="Close">
            <XIcon size={18} />
          </button>
        </div>
        <p className="text-sm text-secondary mb-5">
          Picks pallets oldest-first by milling date, until the requested weight is covered.
        </p>

        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wide text-muted mb-1">Variety</label>
            <select
              className="input"
              value={varietyId}
              onChange={(e) => setVarietyId(e.target.value)}
            >
              <option value="">Any variety</option>
              {varieties.map(v => (
                <option key={v.id} value={v.id}>{v.code} — {v.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold uppercase tracking-wide text-muted mb-1">Weight needed (kg)</label>
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
          className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-sky-600 text-white text-sm font-semibold hover:bg-sky-700 disabled:opacity-50"
        >
          {recommend.isPending ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
          Find oldest pallets
        </button>

        {result && (
          <div className="mt-5 space-y-3">
            <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 ring-1 ring-slate-200 dark:ring-slate-700 p-3 text-sm">
              <div className="flex items-baseline gap-3 flex-wrap">
                <span className="text-muted">Requested:</span>
                <span className="font-bold text-primary tabular-nums">{result.requested_kg.toLocaleString()} kg</span>
                <span className="text-muted">·</span>
                <span className="text-muted">Covered:</span>
                <span className="font-bold text-emerald-600 tabular-nums">{result.total_kg.toLocaleString()} kg</span>
                {result.shortfall_kg > 0 && (
                  <>
                    <span className="text-muted">·</span>
                    <span className="font-bold text-rose-600 tabular-nums flex items-center gap-1">
                      <AlertTriangle size={12} /> short {result.shortfall_kg.toLocaleString()} kg
                    </span>
                  </>
                )}
              </div>
            </div>

            {result.pallets.length === 0 ? (
              <p className="text-sm text-muted text-center py-4">No matching pallets in stock.</p>
            ) : (
              <div className="max-h-56 overflow-y-auto rounded-xl ring-1 ring-slate-200 dark:ring-slate-700 divide-y divide-slate-100 dark:divide-slate-800">
                {result.pallets.map((p, i) => (
                  <div key={p.id} className="px-3 py-2 flex items-center gap-3 text-sm">
                    <span className="w-6 text-xs font-bold text-muted tabular-nums">{i + 1}.</span>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-primary">{p.pallet_code}</p>
                      <p className="text-xs text-muted">{p.variety_code || "—"} · milled {p.milling_date} ({p.days_old}d old)</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-semibold text-primary tabular-nums">{p.weight_kg.toLocaleString()} kg</p>
                      <p className="text-[10px] uppercase font-bold capitalize text-muted">{p.aging_status}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="flex-1 px-4 py-2 rounded-lg ring-1 ring-slate-300 dark:ring-slate-600 text-sm font-semibold text-secondary hover:bg-slate-50 dark:hover:bg-slate-800/60"
              >
                Cancel
              </button>
              <button
                onClick={() => { onApply(result.pallet_ids); onClose(); }}
                disabled={result.pallets.length === 0}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50"
              >
                <ArrowDownToLine size={14} />
                Highlight on canva
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
