import { CloudDrizzle, CloudRain, Lock, Sparkles, Sun } from "lucide-react";
import { useFeature } from "../hooks/useFeature";
import { useDryingAdvisory } from "../hooks/useDryingAdvisory";
import type { Coords } from "../hooks/useGeolocation";
import type { DryingVerdict } from "../services/DryingAdvisorService";

const VERDICT_ICON: Record<DryingVerdict, React.ElementType> = {
  good: Sun,
  caution: CloudDrizzle,
  poor: CloudRain,
};

const VERDICT_TINT: Record<DryingVerdict, string> = {
  good: "text-emerald-500",
  caution: "text-amber-500",
  poor: "text-rose-500",
};

/** Palay Drying Advisor (inline, lives inside the expanded weather card).
 *
 *  DeepSeek reads the same forecast the weather card shows and recommends
 *  whether it's a good day/week to sun-dry wet palay. Enterprise-plan only —
 *  other tenants see a compact upsell instead of the fetch firing at all.
 *  Hidden below lg so the weather card doesn't get cramped on small screens. */
export default function DryingAdvisor({ coords }: { coords: Coords | null }) {
  const allowed = useFeature("drying_advisor");
  const q = useDryingAdvisory(coords, { enabled: allowed });

  return (
    <div
      className="shrink-0 self-stretch hidden lg:flex flex-col justify-center w-56 pl-4 ml-1 border-l border-soft"
      data-testid="drying-advisor"
    >
      <div className="flex items-center gap-2">
        <div className="h-8 w-8 rounded-lg bg-grad-brand grid place-items-center shadow-grad-glow shrink-0">
          <Sparkles size={15} className="text-white" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-bold text-primary leading-tight">Drying Advisor</p>
          <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-violet-600 dark:text-violet-400">
            AI
          </span>
        </div>
      </div>

      {!allowed && (
        <div
          className="mt-2.5 rounded-xl ring-1 ring-amber-200 dark:ring-amber-800 bg-amber-50 dark:bg-amber-900/20 p-2.5 flex items-start gap-2"
          data-testid="drying-advisor-upsell"
        >
          <Lock size={13} className="text-amber-500 shrink-0 mt-0.5" />
          <p className="text-[11px] leading-snug text-amber-900 dark:text-amber-200">
            Available on <span className="font-semibold">Enterprise</span>. Ask your admin to upgrade.
          </p>
        </div>
      )}

      {allowed && q.isLoading && (
        <div className="mt-2.5 rounded-xl ring-1 ring-soft bg-slate-500/5 p-2.5 space-y-1.5" data-testid="drying-advisor-loading">
          <div className="flex items-center gap-1.5">
            <Sun size={13} className="text-amber-400 shrink-0" />
            <span className="h-2.5 w-20 rounded bg-slate-300/60 dark:bg-slate-600/50 animate-pulse" />
          </div>
          <span className="block h-2 w-full rounded bg-slate-200/70 dark:bg-slate-700/50" />
          <span className="block h-2 w-3/4 rounded bg-slate-200/70 dark:bg-slate-700/50" />
        </div>
      )}

      {allowed && !q.isLoading && (q.isError || !q.data) && (
        <p className="mt-2.5 text-[11px] text-muted" data-testid="drying-advisor-error">
          Advisor unavailable right now.
        </p>
      )}

      {allowed && q.data && (
        <div className="mt-2.5 rounded-xl ring-1 ring-soft bg-slate-500/5 p-2.5" data-testid="drying-advisor-result">
          {(() => {
            const Icon = VERDICT_ICON[q.data.verdict] ?? Sun;
            const tint = VERDICT_TINT[q.data.verdict] ?? "text-slate-500";
            return (
              <div className="flex items-center gap-1.5">
                <Icon size={13} className={`${tint} shrink-0`} />
                <span className="text-xs font-semibold text-primary truncate">{q.data.headline}</span>
              </div>
            );
          })()}
          <p className="mt-1 text-[11px] leading-snug text-secondary line-clamp-2">{q.data.reasoning}</p>
          {q.data.best_window && (
            <p className="mt-1 text-[10px] text-muted truncate">Best: {q.data.best_window}</p>
          )}
        </div>
      )}
    </div>
  );
}
