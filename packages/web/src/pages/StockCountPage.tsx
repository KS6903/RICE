// Stock count: weigh or count what's on the floor, line by line, without seeing
// what the records say. Saved, it's set against the records; lines out by more
// than the allowance wait for the owner. A count changes no stock: corrections
// are made in Inventory.
import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccess } from "../hooks/useAccess";
import { stockCountService, type SheetLine, type StockCount } from "../services/StockCountService";

const kg = (n: number) => `${n.toLocaleString(undefined, { maximumFractionDigits: 1 })} kg`;
const day = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
const key = (line: SheetLine) => `${line.kind}:${line.inventory_id}`;

function errorText(error: unknown, fallback: string): string {
  const detail = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  return typeof detail === "string" ? detail : fallback;
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
    <article aria-label={`Count of ${day(count.date)}`} className="card !p-4 space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-semibold text-primary">
          {day(count.date)}
          {count.counted_by ? `, by ${count.counted_by}` : ""}
        </span>
        {out.length === 0 ? (
          <span className="badge-green">All within the allowance</span>
        ) : (
          <span className="badge-red">
            {out.length} {out.length === 1 ? "line" : "lines"} out
          </span>
        )}
      </div>
      {out.length > 0 && (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-secondary">
              <th className="py-1 font-semibold">Item</th>
              <th className="py-1 font-semibold text-right">Records</th>
              <th className="py-1 font-semibold text-right">Counted</th>
              <th className="py-1 font-semibold text-right">Difference</th>
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
          Reviewed by {count.reviewed_by}: {count.review_note}
        </p>
      )}
      {count.needs_review && manager && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-[12rem]">
            <label htmlFor={`stock-review-${count.id}`} className="form-label">
              What you found
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
            Mark reviewed
          </button>
        </div>
      )}
      {count.needs_review && !manager && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          Waiting for the owner to review.
        </p>
      )}
    </article>
  );
}

export default function StockCountPage() {
  const queryClient = useQueryClient();
  const { canEdit } = useAccess();
  const page = useQuery({ queryKey: ["stock-count"], queryFn: () => stockCountService.page() });
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const save = useMutation({
    mutationFn: (sheet: SheetLine[]) =>
      stockCountService.record({
        lines: sheet
          .filter((line) => (counted[key(line)] ?? "") !== "")
          .map((line) => ({
            kind: line.kind,
            inventory_id: line.inventory_id,
            counted_kg: counted[key(line)],
          })),
        note,
      }),
    onSuccess: () => {
      setCounted({});
      setNote("");
      void queryClient.invalidateQueries({ queryKey: ["stock-count"] });
    },
  });

  if (page.isLoading) return <div className="card skeleton h-64" aria-busy="true" />;
  if (page.isError || !page.data) {
    return (
      <div className="card">
        <p className="text-secondary">
          {errorText(page.error, "The stock count couldn't load. Try again in a moment.")}
        </p>
      </div>
    );
  }
  const { sheet, tolerance_pct, manager, counts } = page.data;
  const filled = sheet.filter((line) => (counted[key(line)] ?? "") !== "").length;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-primary">Stock count</h1>
        <p className="text-secondary mt-1 max-w-2xl">
          Weigh or count what's there, line by line. You won't see what the records say until it's
          saved, so the count stays honest. Lines out by more than {tolerance_pct}% go to the owner;
          stock is corrected in{" "}
          <Link to="/inventory" className="link">
            Inventory
          </Link>
          .
        </p>
      </header>

      {canEdit("inventory") ? (
        <section aria-label="Count sheet" className="card space-y-4">
          {sheet.length === 0 ? (
            <p className="text-sm text-secondary">There's no stock on record to count.</p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {sheet.map((line) => (
                <li key={key(line)} className="flex items-center justify-between gap-3 py-2">
                  <label htmlFor={`count-${key(line)}`} className="text-sm text-primary">
                    {line.label}
                  </label>
                  <span className="flex items-center gap-2">
                    <input
                      id={`count-${key(line)}`}
                      inputMode="decimal"
                      className="input w-32 text-right"
                      value={counted[key(line)] ?? ""}
                      onChange={(e) =>
                        setCounted((c) => ({
                          ...c,
                          [key(line)]: e.target.value.replace(/[^\d.]/g, ""),
                        }))
                      }
                    />
                    <span className="text-sm text-secondary">kg</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div>
            <label htmlFor="stock-note" className="form-label">
              Note (optional)
            </label>
            <input
              id="stock-note"
              className="input"
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <button
            type="button"
            className="btn-primary"
            disabled={filled === 0 || save.isPending}
            onClick={() => save.mutate(sheet)}
          >
            {save.isPending
              ? "Saving…"
              : `Save the count (${filled} of ${sheet.length} ${sheet.length === 1 ? "line" : "lines"})`}
          </button>
          {save.isError && (
            <p className="text-sm text-rose-600 dark:text-rose-400" role="alert">
              {errorText(save.error, "Couldn't save the count. Try again.")}
            </p>
          )}
        </section>
      ) : (
        <p className="text-sm text-secondary">Only staff who manage the stock can count it.</p>
      )}

      <section aria-label="Recent counts" className="space-y-3">
        <h2 className="font-bold text-primary">Recent counts</h2>
        {counts.length === 0 ? (
          <p className="text-sm text-secondary">No counts yet.</p>
        ) : (
          counts.map((c) => <CountCard key={c.id} count={c} manager={manager} />)
        )}
      </section>
    </div>
  );
}
