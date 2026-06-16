import { Sparkles, Sun, Wand2 } from "lucide-react";

/** PLACEHOLDER — Palay Drying Advisor (inline, lives inside the weather card).
 *
 *  Reserved slot for an agentic AI assistant that will read the weather
 *  forecast and advise whether it's a good day / week to sun-dry wet palay.
 *  No logic yet — a compact "coming soon" column with a skeleton preview. Wire
 *  the real model here later (the hourly/daily forecast is already fetched on
 *  the dashboard via useForecast). Hidden below lg so the weather card doesn't
 *  get cramped on small screens. */
export default function DryingAdvisor() {
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
            <Wand2 size={9} /> AI · Soon
          </span>
        </div>
      </div>

      {/* Skeleton suggestion — conveys a pending AI recommendation */}
      <div className="mt-2.5 rounded-xl ring-1 ring-soft bg-slate-500/5 p-2.5 space-y-1.5">
        <div className="flex items-center gap-1.5">
          <Sun size={13} className="text-amber-400 shrink-0" />
          <span className="h-2.5 w-20 rounded bg-slate-300/60 dark:bg-slate-600/50 animate-pulse" />
        </div>
        <span className="block h-2 w-full rounded bg-slate-200/70 dark:bg-slate-700/50" />
        <span className="block h-2 w-3/4 rounded bg-slate-200/70 dark:bg-slate-700/50" />
      </div>
    </div>
  );
}
