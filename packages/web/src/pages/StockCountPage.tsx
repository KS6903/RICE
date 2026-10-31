// Stock count: weigh or count what's on the floor, line by line, without seeing
// what the records say. Saved, it's set against the records; lines out by more
// than the allowance wait for the owner. A count changes no stock: corrections
// are made in Inventory.
//
// A count is of one branch, picked at the top. The sheet is grouped the way a
// counter walks the floor (rice, palay and by-products), and a line can be
// counted in sacks plus loose kilos: the page works out the kilos. Each kind of
// stock has a default way to count, and each line can have its own; the mill
// keeps these for the next count. An unsaved count is kept in this browser, so
// a refresh halfway through the warehouse loses nothing.
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Circle } from "lucide-react";
import { useAccess } from "../hooks/useAccess";
import { useAuthStore } from "../stores/authStore";
import { useBranchStore } from "../stores/branchStore";
import Select from "../components/Select";
import {
  stockCountService,
  type CountChoices,
  type CountUnit as Unit,
  type SheetLine,
  type StockCount,
  type StockCountPage as PageData,
} from "../services/StockCountService";
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

type Kind = SheetLine["kind"];
const KINDS: { kind: Kind; title: string }[] = [
  { kind: "milled_rice", title: t("Milled rice") },
  { kind: "palay", title: t("Palay") },
  { kind: "byproduct", title: t("By-products") },
];

// Lines of a mill with several branches whose stock has no branch on record.
const NO_BRANCH = "none";
const branchOf = (line: SheetLine) => line.branch_id ?? NO_BRANCH;

// What was typed for one line: whole sacks and loose kilos (in kilos mode the
// kilos are the whole count).
type Entry = { sacks?: string; kg?: string };
type Draft = { entries: Record<string, Entry>; note: string; branch: string | null };

// How to count, as it's being typed: each kind's default, and what a line changes.
type Choices = {
  defaults: Record<Kind, { unit: Unit; sackKg: string }>;
  lines: Record<string, { unit?: Unit; sackKg?: string }>;
};

function fromApi(saved: CountChoices): Choices {
  const fallback = (kind: Kind) => ({
    unit: saved.defaults[kind]?.unit ?? ("sacks" as Unit),
    sackKg: String(saved.defaults[kind]?.sack_kg ?? 50),
  });
  return {
    defaults: {
      milled_rice: fallback("milled_rice"),
      palay: fallback("palay"),
      byproduct: fallback("byproduct"),
    },
    lines: Object.fromEntries(
      Object.entries(saved.lines).map(([id, c]) => [
        id,
        {
          ...(c.unit ? { unit: c.unit } : {}),
          ...(c.sack_kg ? { sackKg: String(c.sack_kg) } : {}),
        },
      ]),
    ),
  };
}

// A sack size still being typed isn't saved.
const sackSize = (raw?: string) => {
  const n = Number(raw);
  return n > 0 && n <= 1000 ? { sack_kg: n } : {};
};

function toApi(choices: Choices): CountChoices {
  return {
    defaults: Object.fromEntries(
      Object.entries(choices.defaults).map(([kind, c]) => [
        kind,
        { unit: c.unit, ...sackSize(c.sackKg) },
      ]),
    ),
    lines: Object.fromEntries(
      Object.entries(choices.lines).map(([id, c]) => [
        id,
        { ...(c.unit ? { unit: c.unit } : {}), ...sackSize(c.sackKg) },
      ]),
    ),
  };
}

const pick = (line: SheetLine, choices: Choices) => {
  const own = choices.lines[line.inventory_id];
  const base = choices.defaults[line.kind];
  return {
    unit: own?.unit ?? base.unit,
    sackKg: own?.sackKg ?? base.sackKg,
    custom: own?.unit !== undefined || own?.sackKg !== undefined,
  };
};

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
          {count.branch ? `, ${count.branch}` : ""}
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

function UnitSwitch({
  label,
  value,
  labels,
  small = false,
  onChange,
}: {
  label: string;
  value: Unit;
  labels: Record<Unit, string>;
  small?: boolean;
  onChange: (unit: Unit) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex rounded-xl p-0.5 ring-1 ring-soft"
    >
      {(["sacks", "kg"] as const).map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={value === option}
          onClick={() => onChange(option)}
          className={`rounded-lg font-semibold transition-colors ${
            small ? "px-2 py-1 text-xs" : "px-3 py-1.5 text-sm"
          } ${
            value === option
              ? "bg-grad-brand text-white shadow-grad-glow"
              : "text-secondary hover:text-primary"
          }`}
        >
          {labels[option]}
        </button>
      ))}
    </div>
  );
}

function CountRow({
  line,
  entry,
  choice,
  onChange,
  onUnit,
  onSackKg,
  onUseDefault,
  onEnter,
}: {
  line: SheetLine;
  entry: Entry | undefined;
  choice: ReturnType<typeof pick>;
  onChange: (entry: Entry) => void;
  onUnit: (unit: Unit) => void;
  onSackKg: (sackKg: string) => void;
  onUseDefault: () => void;
  onEnter: (e: KeyboardEvent<HTMLInputElement>) => void;
}) {
  const done = !blank(entry);
  const { unit } = choice;
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
      <span className="flex flex-wrap items-center gap-2">
        <UnitSwitch
          small
          label={t("{{label}}, count in", { label: line.label })}
          value={unit}
          labels={{ sacks: t("Sacks"), kg: t("Kilos") }}
          onChange={onUnit}
        />
        {unit === "sacks" && (
          <label className="flex items-center gap-1 text-xs text-secondary">
            <input
              aria-label={t("{{label}}, kilos per sack", { label: line.label })}
              inputMode="decimal"
              className="input !py-1 w-14 text-right text-xs tabular-nums"
              value={choice.sackKg}
              onChange={(e) => onSackKg(digits(e.target.value))}
            />
            {t("kg a sack")}
          </label>
        )}
        {choice.custom && (
          <button
            type="button"
            aria-label={t("{{label}}, use the default", { label: line.label })}
            className="text-xs font-semibold text-secondary hover:text-primary"
            onClick={onUseDefault}
          >
            {t("Use default")}
          </button>
        )}
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
          {done ? `= ${kg(totalKg(entry!, unit, Number(choice.sackKg) || 0))}` : ""}
        </span>
      )}
    </li>
  );
}

function CountSheet({ data }: { data: PageData }) {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const storeKey = `stock-count-draft:${user?.id ?? "anyone"}`;
  const topBarBranch = useBranchStore((s) => s.view);
  const { sheet } = data;

  const [draft] = useState(() => loadDraft(storeKey));
  const [entries, setEntries] = useState<Record<string, Entry>>(draft.entries ?? {});
  const [note, setNote] = useState(draft.note ?? "");
  const [picked, setPicked] = useState<string | null>(draft.branch ?? null);
  const [choices, setChoices] = useState<Choices>(() => fromApi(data.choices));
  const sheetRef = useRef<HTMLElement>(null);

  const branches = [...new Map(sheet.map((l) => [branchOf(l), l.branch ?? ""])).entries()]
    .map(([value, name]) => ({ value, label: name || t("No branch") }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const severalBranches = sheet.some((l) => l.branch) || branches.length > 1;
  // What was picked here, else the top bar's branch, else the person's own.
  const branch =
    [picked, topBarBranch, user?.branch_id].find(
      (id) => id && branches.some((b) => b.value === id),
    ) ??
    branches[0]?.value ??
    NO_BRANCH;
  const lines = sheet.filter((l) => branchOf(l) === branch);

  useEffect(() => {
    const started = Object.values(entries).some((e) => !blank(e)) || note.trim() !== "";
    keepDraft(storeKey, started ? { entries, note, branch: picked } : null);
  }, [storeKey, entries, note, picked]);

  const saveChoices = useMutation({
    mutationFn: (next: CountChoices) => stockCountService.saveChoices(next),
    onSuccess: (saved) =>
      queryClient.setQueryData<PageData>(["stock-count"], (old) =>
        old ? { ...old, choices: saved } : old,
      ),
  });
  const { mutate: sendChoices } = saveChoices;
  // Kept for the mill a moment after the last change, not on every keystroke.
  const savedChoices = useRef(JSON.stringify(toApi(choices)));
  useEffect(() => {
    const next = toApi(choices);
    const text = JSON.stringify(next);
    if (text === savedChoices.current) return;
    const timer = setTimeout(() => {
      savedChoices.current = text;
      sendChoices(next);
    }, 600);
    return () => clearTimeout(timer);
  }, [choices, sendChoices]);

  const save = useMutation({
    mutationFn: (counted: SheetLine[]) =>
      stockCountService.record({
        lines: counted.map((line) => {
          const { unit, sackKg } = pick(line, choices);
          return {
            kind: line.kind,
            inventory_id: line.inventory_id,
            counted_kg: asDecimal(totalKg(entries[key(line)], unit, Number(sackKg) || 0)),
          };
        }),
        note,
        branch_id: branch === NO_BRANCH ? null : branch,
      }),
    onSuccess: (_, counted) => {
      // Lines typed for another branch wait for that branch's count.
      const done = new Set(counted.map(key));
      setEntries((all) => Object.fromEntries(Object.entries(all).filter(([k]) => !done.has(k))));
      setNote("");
      void queryClient.invalidateQueries({ queryKey: ["stock-count"] });
    },
  });

  // A line going from sacks to kilos folds its sacks in, so no count changes underneath.
  const changeChoices = (next: Choices) => {
    setEntries((all) => {
      const folded = { ...all };
      for (const line of sheet) {
        const e = all[key(line)];
        const before = pick(line, choices);
        if (e && !blank(e) && before.unit === "sacks" && pick(line, next).unit === "kg") {
          folded[key(line)] = { kg: asDecimal(totalKg(e, "sacks", Number(before.sackKg) || 0)) };
        }
      }
      return folded;
    });
    setChoices(next);
  };
  const changeDefault = (kind: Kind, change: Partial<Choices["defaults"][Kind]>) =>
    changeChoices({
      ...choices,
      defaults: { ...choices.defaults, [kind]: { ...choices.defaults[kind], ...change } },
    });
  const changeLine = (line: SheetLine, change: Choices["lines"][string] | null) => {
    const { [line.inventory_id]: own, ...others } = choices.lines;
    changeChoices({
      ...choices,
      lines: change ? { ...others, [line.inventory_id]: { ...own, ...change } } : others,
    });
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

  const counted = lines.filter((line) => !blank(entries[key(line)]));
  const sacksWithoutSize = counted.some((line) => {
    const { unit, sackKg } = pick(line, choices);
    return unit === "sacks" && !(Number(sackKg) > 0);
  });

  return (
    <section ref={sheetRef} aria-label={t("Count sheet")} className="card space-y-5">
      {sheet.length === 0 ? (
        <p className="text-sm text-secondary">{t("There's no stock on record to count.")}</p>
      ) : (
        <>
          {severalBranches && (
            <div className="max-w-xs">
              <label htmlFor="stock-count-branch" className="form-label">
                {t("Branch you're counting")}
              </label>
              <Select
                id="stock-count-branch"
                value={branch}
                onChange={setPicked}
                options={branches}
              />
            </div>
          )}

          {KINDS.map(({ kind, title }) => {
            const ofKind = lines.filter((line) => line.kind === kind);
            if (ofKind.length === 0) return null;
            const done = ofKind.filter((line) => !blank(entries[key(line)])).length;
            const base = choices.defaults[kind];
            return (
              <div key={kind} role="group" aria-label={title} className="space-y-2">
                <div className="flex items-baseline justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-muted">{title}</h3>
                  <span className="text-xs text-muted tabular-nums">
                    {t("{{done}} of {{linesCount}}", { done, linesCount: ofKind.length })}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <UnitSwitch
                    label={t("Default for {{title}}", { title })}
                    value={base.unit}
                    labels={{ sacks: t("Sacks + kg"), kg: t("Kilos only") }}
                    onChange={(unit) => changeDefault(kind, { unit })}
                  />
                  {base.unit === "sacks" && (
                    <label className="flex items-center gap-2 text-sm text-secondary">
                      {t("One sack is")}
                      <input
                        aria-label={t("Kilos per sack, {{title}}", { title })}
                        inputMode="decimal"
                        className="input !py-1.5 w-20 text-right tabular-nums"
                        value={base.sackKg}
                        onChange={(e) => changeDefault(kind, { sackKg: digits(e.target.value) })}
                      />
                      {t("kg")}
                    </label>
                  )}
                </div>
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                  {ofKind.map((line) => (
                    <CountRow
                      key={key(line)}
                      line={line}
                      entry={entries[key(line)]}
                      choice={pick(line, choices)}
                      onChange={(entry) => setEntries((all) => ({ ...all, [key(line)]: entry }))}
                      onUnit={(unit) => changeLine(line, { unit })}
                      onSackKg={(sackKg) => changeLine(line, { sackKg })}
                      onUseDefault={() => changeLine(line, null)}
                      onEnter={nextBox}
                    />
                  ))}
                </ul>
              </div>
            );
          })}
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
      {saveChoices.isError && (
        <p className="text-sm text-rose-600 dark:text-rose-400" role="alert">
          {errorText(saveChoices.error, t("Couldn't keep your sack and kilo choices."))}
        </p>
      )}
      <div className="sticky bottom-3 z-10 -mx-2 flex items-center gap-3 rounded-xl glass-strong px-3 py-2.5 shadow-lg ring-1 ring-soft">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-primary tabular-nums">
            {t("{{filled}} of {{sheetCount}} counted", {
              filled: counted.length,
              sheetCount: lines.length,
            })}
          </p>
          <div className="mt-1 h-1.5 rounded-full bg-slate-200 dark:bg-slate-700">
            <div
              className="h-1.5 rounded-full bg-emerald-500 transition-[width]"
              style={{ width: `${lines.length ? (counted.length / lines.length) * 100 : 0}%` }}
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
          disabled={counted.length === 0 || sacksWithoutSize || save.isPending}
          onClick={() => save.mutate(counted)}
        >
          {save.isPending ? t("Saving…") : t("Save the count")}
        </button>
      </div>
    </section>
  );
}

export default function StockCountPage() {
  const { canEdit } = useAccess();
  const page = useQuery({ queryKey: ["stock-count"], queryFn: () => stockCountService.page() });

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
  const { manager, counts } = page.data;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-primary">{t("Stock count")}</h1>
      </header>

      {canEdit("inventory") ? (
        <CountSheet data={page.data} />
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
