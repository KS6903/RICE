// Cash count: the drawer at close against what it should hold. Opening cash plus
// the cash received today, less what was paid out, is what should be there; the
// cashier counts it, and a difference beyond the allowance waits for the owner.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { useAccess } from "../hooks/useAccess";
import { cashService, type CashCount } from "../services/CashService";
import { t } from "../i18n";

const php = (n: number) =>
  `₱${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

const day = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

const money = (raw: string) => raw.replace(/[^\d.]/g, "");
const num = (raw: string) => Number(raw || 0);

function errorText(error: unknown, fallback: string): string {
  const detail = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  return typeof detail === "string" ? detail : fallback;
}

function Difference({ value, tolerance }: { value: number; tolerance: number }) {
  if (Math.abs(value) <= tolerance) {
    return (
      <span className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400 font-semibold">
        <CheckCircle2 size={16} aria-hidden />
        {value === 0
          ? t("Balanced")
          : value < 0
            ? t("Short by {{amount}}, within the allowance", { amount: php(Math.abs(value)) })
            : t("Over by {{amount}}, within the allowance", { amount: php(Math.abs(value)) })}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-rose-600 dark:text-rose-400 font-semibold">
      <AlertTriangle size={16} aria-hidden />
      {value < 0
        ? t("Short by {{amount}}", { amount: php(Math.abs(value)) })
        : t("Over by {{amount}}", { amount: php(Math.abs(value)) })}
    </span>
  );
}

function ReviewForm({ count }: { count: CashCount }) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");
  const review = useMutation({
    mutationFn: () => cashService.review(count.id, note),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["cash"] }),
  });
  return (
    <div className="flex flex-wrap items-end gap-2 mt-2">
      <div className="flex-1 min-w-[12rem]">
        <label htmlFor={`review-${count.id}`} className="form-label">
          {t("What you found")}
        </label>
        <input
          id={`review-${count.id}`}
          className="input"
          maxLength={500}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      <button
        type="button"
        className="btn-primary"
        disabled={!note.trim() || review.isPending}
        onClick={() => review.mutate()}
      >
        {t("Mark reviewed")}
      </button>
    </div>
  );
}

export default function CashCountPage() {
  const queryClient = useQueryClient();
  const { canEdit } = useAccess();
  const page = useQuery({ queryKey: ["cash"], queryFn: () => cashService.page() });
  const [counted, setCounted] = useState("");
  const [cashOut, setCashOut] = useState("");
  const [takenOut, setTakenOut] = useState("");
  const [note, setNote] = useState("");
  const save = useMutation({
    mutationFn: () =>
      cashService.count({ counted, cash_out: cashOut || "0", taken_out: takenOut || "0", note }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["cash"] }),
  });

  if (page.isLoading) return <div className="card skeleton h-64" aria-busy="true" />;
  if (page.isError || !page.data) {
    return (
      <div className="card">
        <p className="text-secondary">
          {errorText(page.error, t("The cash count couldn't load. Try again in a moment."))}
        </p>
      </div>
    );
  }
  const { today, tolerance, manager, counts } = page.data;
  const todays = counts.find((c) => c.date === today.date);
  const expected = today.opening + today.cash_in - num(cashOut);
  const canCount = canEdit("sales");

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-primary">{t("Cash count")}</h1>
        <p className="text-secondary mt-1 max-w-2xl">
          {t(
            "Count the drawer at close. What should be there is the opening cash, plus the cash received today, less what was paid out from it.",
          )}
        </p>
      </header>

      <section
        aria-label={t("Today, {{date}}", { date: day(today.date) })}
        className="card space-y-5"
      >
        <h2 className="font-bold text-primary">
          {t("Today,")} {day(today.date)}
        </h2>
        <dl className="grid gap-3 sm:grid-cols-3 text-sm">
          <div>
            <dt className="text-secondary">{t("Opening cash")}</dt>
            <dd className="text-lg font-bold text-primary">{php(today.opening)}</dd>
            <dd className="text-xs text-muted">
              {t("Yesterday's count, less what was taken out.")}
            </dd>
          </div>
          <div>
            <dt className="text-secondary">{t("Cash received today")}</dt>
            <dd className="text-lg font-bold text-primary">{php(today.cash_in)}</dd>
            {today.cash_received.map((r) => (
              <dd key={r.who} className="text-xs text-muted">
                {r.who}: {php(r.amount)}
              </dd>
            ))}
          </div>
          <div>
            <dt className="text-secondary">{t("Should be in the drawer")}</dt>
            <dd className="text-lg font-bold text-primary" aria-live="polite">
              {php(expected)}
            </dd>
          </div>
        </dl>

        {canCount ? (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label htmlFor="cash-out" className="form-label">
                  {t("Paid out from the drawer")}
                </label>
                <input
                  id="cash-out"
                  inputMode="decimal"
                  className="input"
                  value={cashOut}
                  onChange={(e) => setCashOut(money(e.target.value))}
                />
                <p className="text-xs text-secondary mt-1">
                  {t("Palay paid in cash, expenses, change for the truck.")}
                  {today.expenses_entered > 0 &&
                    t(" Expenses entered today: {{expenses_entered}}.", {
                      expenses_entered: php(today.expenses_entered),
                    })}
                </p>
              </div>
              <div>
                <label htmlFor="cash-counted" className="form-label">
                  {t("Counted in the drawer")}
                </label>
                <input
                  id="cash-counted"
                  inputMode="decimal"
                  className="input"
                  value={counted}
                  onChange={(e) => setCounted(money(e.target.value))}
                />
                {counted && (
                  <p className="text-sm mt-1">
                    <Difference value={num(counted) - expected} tolerance={tolerance} />
                  </p>
                )}
              </div>
              <div>
                <label htmlFor="cash-taken" className="form-label">
                  {t("Taken out at close (optional)")}
                </label>
                <input
                  id="cash-taken"
                  inputMode="decimal"
                  className="input"
                  value={takenOut}
                  onChange={(e) => setTakenOut(money(e.target.value))}
                />
                <p className="text-xs text-secondary mt-1">
                  {t("Banked, or handed to the owner. Tomorrow opens without it.")}
                </p>
              </div>
            </div>
            <div>
              <label htmlFor="cash-note" className="form-label">
                {t("Note (optional)")}
              </label>
              <input
                id="cash-note"
                className="input"
                maxLength={500}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
            <button
              type="button"
              className="btn-primary"
              disabled={!counted || save.isPending}
              onClick={() => save.mutate()}
            >
              {save.isPending
                ? t("Saving…")
                : todays
                  ? t("Save the corrected count")
                  : t("Save the count")}
            </button>
            {todays && (
              <p className="text-xs text-secondary">
                {t(
                  "Counted already today by {{counted_by}}: {{counted}}. Saving again replaces it.",
                  { counted_by: todays.counted_by, counted: php(todays.counted) },
                )}
              </p>
            )}
            {save.isError && (
              <p className="text-sm text-rose-600 dark:text-rose-400" role="alert">
                {errorText(save.error, t("Couldn't save the count. Try again."))}
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-secondary">
            {t("Only staff who handle sales can count the drawer.")}
          </p>
        )}
      </section>

      <section aria-label={t("Recent counts")} className="space-y-3">
        <h2 className="font-bold text-primary">{t("Recent counts")}</h2>
        {counts.length === 0 ? (
          <p className="text-sm text-secondary">{t("No counts yet.")}</p>
        ) : (
          counts.map((c) => (
            <article key={c.id} aria-label={day(c.date)} className="card !p-4 space-y-1">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-semibold text-primary">{day(c.date)}</span>
                <Difference value={c.difference} tolerance={tolerance} />
              </div>
              <p className="text-sm text-secondary">
                {t("Expected {{expected}}, counted {{counted}}", {
                  expected: php(c.expected),
                  counted: php(c.counted),
                })}
                {c.counted_by ? ` by ${c.counted_by}` : ""}.{c.note ? ` "${c.note}"` : ""}
              </p>
              {c.reviewed_by && (
                <p className="text-sm text-primary">
                  {t("Reviewed by {{reviewed_by}}: {{review_note}}", {
                    reviewed_by: c.reviewed_by,
                    review_note: c.review_note,
                  })}
                </p>
              )}
              {c.needs_review && manager && <ReviewForm count={c} />}
              {c.needs_review && !manager && (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  {t("Waiting for the owner to review.")}
                </p>
              )}
            </article>
          ))
        )}
      </section>
    </div>
  );
}
