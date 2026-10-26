// Stock count: weigh or count what's on the floor, line by line, without seeing
// what the records say. Saved, it's set against the records; lines out by more
// than the allowance wait for the owner. A count changes no stock: corrections
// are made in Inventory.
//
// The sheet is grouped the way a counter walks the floor (branch, then rice,
// palay and by-products), and a line can be counted in sacks plus loose kilos:
// the page works out the kilos. An unsaved count is kept in this browser, so a
// refresh halfway through the warehouse loses nothing.
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Circle } from "lucide-react";
import { useAccess } from "../hooks/useAccess";
import { useAuthStore } from "../stores/authStore";
import { stockCountService, type SheetLine, type StockCount } from "../services/StockCountService";
import { t } from "../i18n";

const kg = (n: number) => `${n.toLocaleString(undefined, { maximumFractionDigits: 1 })} kg`;
const day = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
const key = (line: SheetLine) => `${line.kind}:${line.inventory_id}`;
const digits = (raw: string) => raw.replace(/[^\d.]/g, "");

const KINDS: { kind: SheetLine["kind"]; title: string }[] = [
  { kind: "milled_rice", title: t("Milled rice") },
  { kind: "palay", title: t("Palay") },
  { kind: "byproduct", title: t("By-products") },
];

type Unit = "sacks" | "kg";
// What was typed for one line: whole sacks and loose kilos (in kilos mode the
// kilos are the whole count).
type Entry = { sacks?: string; kg?: string };
type Draft = { entries: Record<string, Entry>; note: string; unit: Unit; sackKg: string };

const blank = (e: Entry | undefined) => !e || ((e.sacks ?? "") === "" && (e.kg ?? "") === "");
const totalKg = (e: Entry, unit: Unit, sackKg: number) =>
  (unit === "sacks" ? Number(e.sacks || 0) * sackKg : 0) + Number(e.kg || 0);
const asDecimal = (n: number) => String(Math.round(n * 1000) / 1000);

function errorText(error: unknown, fallback: string): string {
  const detail = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  return typeof detail === "string" ? detail : fallback;
}

// The unsaved count, per user, in this browser only. Storage can be missing
// (a private window): the page works without it.
function loadDraft(storeKey: string): Partial<Draft> {
  try {
    const raw = localStorage.getItem(storeKey);
    return raw ? (JSON.parse(raw) as Partial<Draft>) : {};
  } catch {
    return {};
  }
}
function keepDraft(storeKey: string, draft: Draft | null) {
  try {
    if (draft) localStorage.setItem(storeKey, JSON.stringify(draft));
    else localStorage.removeItem(storeKey);
  } catch {
    // Not kept; nothing else depends on it.
  }
}

function CountCard({ count, manager }: { count: StockCount; manager: boolean }) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");
  const review = useMutation({
    mutationFn: () => stockCountService.review(count.id, note),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["stock-count"] }),
  });
  const out = count.lines.filter((l) => l.out);
  return (
    <article
      aria-label={t("Count of {{date}}", { date: day(count.date) })}
      className="card !p-4 space-y-2"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-semibold text-primary">
          {day(count.date)}
          {count.counted_by ? `, by ${count.counted_by}` : ""}
        </span>
        {out.length === 0 ? (
          <span className="badge-green">{t("All within the allowance")}</span>
        ) : (
          <span className="badge-red">{t("{{count}} lines out", { count: out.length })}</span>
        )}
      </div>
      {out.length > 0 && (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-secondary">
              <th className="py-1 font-semibold">{t("Item")}</th>
              <th className="py-1 font-semibold text-right">{t("Records")}</th>
              <th className="py-1 font-semibold text-right">{t("Counted")}</th>
              <th className="py-1 font-semibold text-right">{t("Difference")}</th>
            </tr>
          </thead>
          <tbody>
            {out.map((l) => (
              <tr key={l.label} className="border-t border-soft">
                <td className="py-1.5">{l.label}</td>
                <td className="py-1.5 text-right">{kg(l.recorded_kg)}</td>
                <td className="py-1.5 text-right">{kg(l.counted_kg)}</td>
                <td className="py-1.5 text-right font-semibold text-rose-600 dark:text-rose-400">
                  {l.difference_kg > 0 ? "+" : ""}
                  {kg(l.difference_kg)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {count.note && <p className="text-sm text-secondary">"{count.note}"</p>}
      {count.reviewed_by && (
        <p className="text-sm text-primary">
          {t("Reviewed by {{reviewed_by}}: {{review_note}}", {
            reviewed_by: count.reviewed_by,
            review_note: count.review_note,
          })}
        </p>
      )}
      {count.needs_review && manager && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-[12rem]">
            <label htmlFor={`stock-review-${count.id}`} className="form-label">
              {t("What you found")}
            </label>
            <input
              id={`stock-review-${count.id}`}
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
      )}
      {count.needs_review && !manager && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          {t("Waiting for the owner to review.")}
        </p>
      )}
    </article>
  );
}

function CountRow({
  line,
  entry,
  unit,
  sackKg,
  onChange,
  onEnter,
}: {
  line: SheetLine;
  entry: Entry | undefined;
  unit: Unit;
  sackKg: number;
  onChange: (entry: Entry) => void;
  onEnter: (e: KeyboardEvent<HTMLInputElement>) => void;
}) {
  const done = !blank(entry);
  const field = "input !py-2 text-right text-base tabular-nums";
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
      <span className="flex min-w-[10rem] flex-1 items-center gap-2">
        {done ? (
          <CheckCircle2
            size={18}
            className="shrink-0 text-emerald-600 dark:text-emerald-400"
            aria-hidden
          />
        ) : (
          <Circle size={18} className="shrink-0 text-muted" aria-hidden />
        )}
        <span className="text-sm font-medium text-primary first-letter:uppercase">
          {line.item || line.label}
        </span>
      </span>
      <span className="flex items-center gap-2">
        {unit === "sacks" && (
          <>
            <input
              data-count-input
              aria-label={`${line.label}, sacks`}
              inputMode="numeric"
              enterKeyHint="next"
              className={`${field} w-20`}
              value={entry?.sacks ?? ""}
              onChange={(e) => onChange({ ...entry, sacks: e.target.value.replace(/\D/g, "") })}
              onKeyDown={onEnter}
            />
            <span className="text-xs text-secondary">{t("sacks +")}</span>
          </>
        )}
        <input
          data-count-input
          aria-label={
            unit === "sacks" ? t("{{label}}, loose kg", { label: line.label }) : line.label
          }
          inputMode="decimal"
          enterKeyHint="next"
          className={`${field} ${unit === "sacks" ? "w-20" : "w-32"}`}
          value={entry?.kg ?? ""}
          onChange={(e) => onChange({ ...entry, kg: digits(e.target.value) })}
          onKeyDown={onEnter}
        />
        <span className="text-xs text-secondary">{t("kg")}</span>
      </span>
      {unit === "sacks" && (
        <span className="w-24 text-right text-sm tabular-nums text-secondary" aria-live="polite">
          {done ? `= ${kg(totalKg(entry!, unit, sackKg))}` : ""}
        </span>
      )}
    </li>
  );
}

export default function StockCountPage() {
  const queryClient = useQueryClient();
  const { canEdit } = useAccess();
  const userId = useAuthStore((s) => s.user?.id) ?? "anyone";
  const storeKey = `stock-count-draft:${userId}`;
  const page = useQuery({ queryKey: ["stock-count"], queryFn: () => stockCountService.page() });

  const [draft] = useState(() => loadDraft(storeKey));
  const [entries, setEntries] = useState<Record<string, Entry>>(draft.entries ?? {});
  const [note, setNote] = useState(draft.note ?? "");
  const [unit, setUnit] = useState<Unit>(draft.unit ?? "sacks");
  const [sackKg, setSackKg] = useState(draft.sackKg ?? "50");
  const sheetRef = useRef<HTMLElement>(null);
  const perSack = Number(sackKg) || 0;

  useEffect(() => {
    const started = Object.values(entries).some((e) => !blank(e)) || note.trim() !== "";
    keepDraft(storeKey, started ? { entries, note, unit, sackKg } : null);
  }, [storeKey, entries, note, unit, sackKg]);

  const save = useMutation({
    mutationFn: (sheet: SheetLine[]) =>
      stockCountService.record({
        lines: sheet
          .filter((line) => !blank(entries[key(line)]))
          .map((line) => ({
            kind: line.kind,
            inventory_id: line.inventory_id,
            counted_kg: asDecimal(totalKg(entries[key(line)], unit, perSack)),
          })),
        note,
      }),
    onSuccess: () => {
      setEntries({});
      setNote("");
      keepDraft(storeKey, null);
      void queryClient.invalidateQueries({ queryKey: ["stock-count"] });
    },
  });

  // Switching to kilos folds the sacks in, so no count changes underneath.
  const switchUnit = (next: Unit) => {
    if (next === unit) return;
    if (next === "kg") {
      setEntries((all) =>
        Object.fromEntries(
          Object.entries(all).map(([k, e]) => [
            k,
            blank(e) ? e : { kg: asDecimal(totalKg(e, "sacks", perSack)) },
          ]),
        ),
      );
    }
    setUnit(next);
  };

  // Enter moves on to the next box, top to bottom, like a paper sheet.
  const nextBox = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const boxes = Array.from(
      sheetRef.current?.querySelectorAll<HTMLInputElement>("[data-count-input]") ?? [],
    );
    boxes[boxes.indexOf(e.currentTarget) + 1]?.focus();
  };

  if (page.isLoading) return <div className="card skeleton h-64" aria-busy="true" />;
  if (page.isError || !page.data) {
    return (
      <div className="card">
        <p className="text-secondary">
          {errorText(page.error, t("The stock count couldn't load. Try again in a moment."))}
        </p>
      </div>
    );
  }
  const { sheet, tolerance_pct, manager, counts } = page.data;
  const filled = sheet.filter((line) => !blank(entries[key(line)])).length;
  const branches = [...new Set(sheet.map((line) => line.branch ?? ""))].sort();
  const sacksWithoutSize = unit === "sacks" && perSack <= 0;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-primary">{t("Stock count")}</h1>
        <p className="text-secondary mt-1 max-w-2xl">
          {t(
            "Count what's on the floor. The records stay hidden until it's saved, so the count stays honest. Lines out by more than {{tolerance_pct}}% go to the owner; stock is corrected in",
            { tolerance_pct },
          )}{" "}
          <Link to="/inventory" className="link">
            {t("Inventory")}
          </Link>
          .
        </p>
      </header>

      {canEdit("inventory") ? (
        <section ref={sheetRef} aria-label={t("Count sheet")} className="card space-y-5">
          {sheet.length === 0 ? (
            <p className="text-sm text-secondary">{t("There's no stock on record to count.")}</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <div
                  role="radiogroup"
                  aria-label={t("Count in")}
                  className="inline-flex rounded-xl p-1 ring-1 ring-soft"
                >
                  {(
                    [
                      ["sacks", t("Sacks + kg")],
                      ["kg", t("Kilos only")],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={unit === value}
                      onClick={() => switchUnit(value)}
                      className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${
                        unit === value
                          ? "bg-grad-brand text-white shadow-grad-glow"
                          : "text-secondary hover:text-primary"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {unit === "sacks" && (
                  <label className="flex items-center gap-2 text-sm text-secondary">
                    {t("One sack is")}
                    <input
                      aria-label={t("Kilos per sack")}
                      inputMode="decimal"
                      className="input !py-1.5 w-20 text-right tabular-nums"
                      value={sackKg}
                      onChange={(e) => setSackKg(digits(e.target.value))}
                    />
                    {t("kg")}
                  </label>
                )}
              </div>

              {branches.map((branch) => (
                <div key={branch || "all"} className="space-y-4">
                  {branch && (
                    <h2 className="text-lg font-bold text-primary border-b border-soft pb-1">
                      {branch}
                    </h2>
                  )}
                  {KINDS.map(({ kind, title }) => {
                    const lines = sheet.filter(
                      (line) => line.kind === kind && (line.branch ?? "") === branch,
                    );
                    if (lines.length === 0) return null;
                    const done = lines.filter((line) => !blank(entries[key(line)])).length;
                    return (
                      <div
                        key={kind}
                        role="group"
                        aria-label={branch ? `${title}, ${branch}` : title}
                      >
                        <div className="flex items-baseline justify-between">
                          <h3 className="text-xs font-bold uppercase tracking-wider text-muted">
                            {title}
                          </h3>
                          <span className="text-xs text-muted tabular-nums">
                            {t("{{done}} of {{linesCount}}", { done, linesCount: lines.length })}
                          </span>
                        </div>
                        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                          {lines.map((line) => (
                            <CountRow
                              key={key(line)}
                              line={line}
                              entry={entries[key(line)]}
                              unit={unit}
                              sackKg={perSack}
                              onChange={(entry) =>
                                setEntries((all) => ({ ...all, [key(line)]: entry }))
                              }
                              onEnter={nextBox}
                            />
                          ))}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              ))}
            </>
          )}
          <div>
            <label htmlFor="stock-note" className="form-label">
              {t("Note (optional)")}
            </label>
            <input
              id="stock-note"
              className="input"
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          {save.isError && (
            <p className="text-sm text-rose-600 dark:text-rose-400" role="alert">
              {errorText(save.error, t("Couldn't save the count. Try again."))}
            </p>
          )}
          <div className="sticky bottom-3 z-10 -mx-2 flex items-center gap-3 rounded-xl glass-strong px-3 py-2.5 shadow-lg ring-1 ring-soft">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-primary tabular-nums">
                {t("{{filled}} of {{sheetCount}} counted", { filled, sheetCount: sheet.length })}
              </p>
              <div className="mt-1 h-1.5 rounded-full bg-slate-200 dark:bg-slate-700">
                <div
                  className="h-1.5 rounded-full bg-emerald-500 transition-[width]"
                  style={{ width: `${sheet.length ? (filled / sheet.length) * 100 : 0}%` }}
                />
              </div>
              {sacksWithoutSize && (
                <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                  {t("Enter how many kilos one sack holds.")}
                </p>
              )}
            </div>
            <button
              type="button"
              className="btn-primary shrink-0"
              disabled={filled === 0 || sacksWithoutSize || save.isPending}
              onClick={() => save.mutate(sheet)}
            >
              {save.isPending ? t("Saving…") : t("Save the count")}
            </button>
          </div>
        </section>
      ) : (
        <p className="text-sm text-secondary">
          {t("Only staff who manage the stock can count it.")}
        </p>
      )}

      <section aria-label={t("Recent counts")} className="space-y-3">
        <h2 className="font-bold text-primary">{t("Recent counts")}</h2>
        {counts.length === 0 ? (
          <p className="text-sm text-secondary">{t("No counts yet.")}</p>
        ) : (
          counts.map((c) => <CountCard key={c.id} count={c} manager={manager} />)
        )}
      </section>
    </div>
  );
}
