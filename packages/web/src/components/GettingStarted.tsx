import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQueries } from "@tanstack/react-query";
import { ArrowRight, Check, Map as MapIcon, X } from "lucide-react";
import { clsx } from "clsx";
import type { AppSection } from "@rice-mill/shared";
import { useAuthStore } from "../stores/authStore";
import { useAccess } from "../hooks/useAccess";
import { planHas } from "../hooks/useFeature";
import { checklistHidden, setChecklistHidden, useHelpStore } from "../stores/helpStore";
import { gettingStartedService, type StepKey } from "../services/GettingStartedService";
import { t } from "../i18n";

type Step = {
  key: StepKey;
  section: AppSection;
  feature: string;
  title: string;
  why: string;
  to: string;
  cta: string;
};

/** The mill's flow in the order it happens: palay in, rice out, rice sold,
 *  costs counted, then the people who'll do it day to day. */
const STEPS: Step[] = [
  {
    key: "paddy",
    section: "paddy",
    feature: "paddy",
    title: t("Record the palay you bought"),
    why: t("Enter the weight, moisture and price. It becomes your palay stock."),
    to: "/paddy?new=1",
    cta: t("Record a purchase"),
  },
  {
    key: "milling",
    section: "milling",
    feature: "milling",
    title: t("Mill a batch"),
    why: t(
      "Say how much palay went in and how much rice came out. Oraiza works out the recovery rate.",
    ),
    to: "/milling?new=1",
    cta: t("Start a batch"),
  },
  {
    key: "sales",
    section: "sales",
    feature: "sales",
    title: t("Sell some rice"),
    why: t("Create an order for a customer, then turn it into an invoice."),
    to: "/sales?new=1",
    cta: t("Create an order"),
  },
  {
    key: "expenses",
    section: "expenses",
    feature: "expenses",
    title: t("Log an expense"),
    why: t("Fuel, power, labor: with costs in, the profit on this page is real."),
    to: "/costs?new=1",
    cta: t("Add an expense"),
  },
  {
    key: "users",
    section: "users",
    feature: "users",
    title: t("Give your staff their own login"),
    why: t("Your cashier, encoder or accountant each see only what their job needs."),
    to: "/users?new=1",
    cta: t("Add a user"),
  },
];

/**
 * First-run checklist on the dashboard. Each step is one link that opens the
 * right form, ticks itself off from the mill's real data, and the whole card
 * goes away once everything the user's role can do is done (or they hide it;
 * the end of the tour brings it back). The guided tour is offered, never started.
 */
export default function GettingStarted() {
  const user = useAuthStore((s) => s.user);
  const { canEdit } = useAccess();
  const userId = user?.id ?? "";
  const startTour = useHelpStore((s) => s.startTour);
  const revision = useHelpStore((s) => s.checklistRevision);
  const hidden = useMemo(
    () => checklistHidden(userId),
    // revision: re-read after the checklist is hidden or shown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [userId, revision],
  );

  // Only the steps this person can actually take: a cashier sees "Sell some rice".
  const steps = STEPS.filter((s) => canEdit(s.section) && planHas(user, s.feature));

  const results = useQueries({
    queries: steps.map((s) => ({
      queryKey: ["getting-started", s.key],
      queryFn: () => gettingStartedService.done(s.key),
      enabled: !hidden,
      // Recheck on every dashboard visit (one row each), so a step done a
      // minute ago is ticked when the user comes back.
      staleTime: 0,
    })),
  });

  if (hidden || steps.length === 0) return null;
  // Wait for every answer: an established mill should never see the card flash.
  if (results.some((r) => r.isPending)) return null;
  // A step whose check failed (e.g. no access after a role change) is left out
  // rather than shown as undone.
  const shown = steps
    .map((s, i) => ({ ...s, done: results[i].data, failed: results[i].isError }))
    .filter((s) => !s.failed);
  const doneCount = shown.filter((s) => s.done).length;
  if (shown.length === 0 || doneCount === shown.length) return null;
  const nextKey = shown.find((s) => !s.done)?.key;

  return (
    <section className="card" aria-labelledby="getting-started-title">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id="getting-started-title" className="text-lg font-bold text-primary">
            {t("Get your mill running")}
          </h2>
          <p className="text-sm text-secondary mt-0.5">
            {t("{{doneCount}} of {{shownCount}} done. Each step opens the form you need.", {
              doneCount,
              shownCount: shown.length,
            })}
          </p>
        </div>
        <div className="shrink-0 flex items-center gap-3">
          <button
            type="button"
            onClick={startTour}
            className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:text-emerald-800 dark:text-emerald-400 dark:hover:text-emerald-300"
          >
            <MapIcon size={14} /> {t("Take the tour")}
          </button>
          <button
            type="button"
            onClick={() => setChecklistHidden(userId, true)}
            title={t("Bring it back at the end of the tour (the ? button)")}
            className="inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-primary"
          >
            <X size={14} /> {t("Hide")}
          </button>
        </div>
      </div>

      <div
        className="mt-3 h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden"
        aria-hidden
      >
        <div
          className="h-full rounded-full bg-emerald-500 transition-all"
          style={{ width: `${(doneCount / shown.length) * 100}%` }}
        />
      </div>

      <ol className="mt-4 divide-y divide-slate-200/70 dark:divide-slate-700/70">
        {shown.map((s, i) => (
          <li key={s.key} className="flex items-center gap-3 py-3">
            <span
              className={clsx(
                "h-7 w-7 shrink-0 rounded-full grid place-items-center text-xs font-bold",
                s.done
                  ? "bg-emerald-500 text-white"
                  : "ring-1 ring-inset ring-slate-300 text-secondary dark:ring-slate-600",
              )}
            >
              {s.done ? <Check size={14} aria-label={t("Done")} /> : i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p
                className={clsx(
                  "font-semibold",
                  s.done ? "text-muted line-through" : "text-primary",
                )}
              >
                {s.title}
              </p>
              {!s.done && <p className="text-sm text-secondary">{s.why}</p>}
            </div>
            {!s.done && (
              <Link
                to={s.to}
                className={clsx(
                  "shrink-0",
                  s.key === nextKey
                    ? "btn-primary"
                    : "inline-flex items-center gap-1 text-sm font-medium text-emerald-700 hover:text-emerald-800 dark:text-emerald-400 dark:hover:text-emerald-300",
                )}
              >
                {s.cta} <ArrowRight size={14} />
              </Link>
            )}
          </li>
        ))}
      </ol>

      {/* A fresh mill's Boss may be starting over with a backup of the old one. */}
      {doneCount === 0 && user?.role === "owner" && (
        <p className="mt-2 border-t border-slate-200/70 dark:border-slate-700/70 pt-3 text-sm text-secondary">
          {t("Starting over from an old account?")}{" "}
          <Link
            to="/retrieve-data"
            className="font-semibold text-emerald-700 hover:text-emerald-800 dark:text-emerald-400"
          >
            {t("Retrieve your data from a backup")}
          </Link>
        </p>
      )}
    </section>
  );
}
