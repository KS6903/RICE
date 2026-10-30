// The recovery calculator inside a palay purchase's window. A small sample of the
// palay is milled and weighed with every part that comes out of it, and the
// calculator shows the recovery rate, the head rice and broken rice, the husk
// and the bran. The result can be recorded on the purchase, or the calculator
// just closed. The formulas, with their sources, are in mappers/RecoveryMapper.ts.
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Calculator, Trash2 } from "lucide-react";
import ConfirmDialog from "../ConfirmDialog";
import Select from "../Select";
import { useIsPhone } from "../../hooks/useIsPhone";
import {
  WEIGHT_UNITS,
  computeRecovery,
  convertAmount,
  formatWeight,
  parseAmount,
  recoveryGap,
  recoveryProblem,
  toKg,
  type RecoveryInput,
  type RecoveryProblem,
  type WeightUnit,
} from "../../mappers/RecoveryMapper";
import { paddyService, type RecoveryTestForm } from "../../services/PaddyService";
import { t } from "../../i18n";

const percent = (n: number) => `${n.toFixed(1)}%`;

/** A saved record changed: what shows it should be fetched again. */
function useRefreshPurchases() {
  const qc = useQueryClient();
  return () => {
    for (const key of ["palay-purchases", "record-history"]) {
      qc.invalidateQueries({ queryKey: [key] });
    }
  };
}

const PROBLEM_TEXT: Record<RecoveryProblem, () => string> = {
  "rice-over-palay": () => t("The milled rice can't weigh more than the palay sample."),
  "head-over-rice": () =>
    t("The head rice is part of the milled rice, so it can't weigh more than it."),
  "part-over-palay": () => t("The husk or the bran can't weigh more than the palay sample."),
};

/** The moisture a line's palay has now: after drying once it's dry, else as bought. */
const moistureOf = (line: any): string => {
  const m = line?.dried_moisture_pct ?? line?.moisture_content_pct;
  return m != null ? String(Number(m)) : "";
};

export function Amount({
  label,
  value,
  onChange,
  placeholder,
  hint,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
  autoFocus?: boolean;
}) {
  return (
    <div>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-secondary">{label}</span>
        <input
          className="input"
          type="number"
          inputMode="decimal"
          min={0}
          step="any"
          autoFocus={autoFocus}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </label>
      {hint && <p className="mt-1 text-[11px] leading-snug text-muted">{hint}</p>}
    </div>
  );
}

export function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-soft dark:bg-slate-800/50">
      <dt className="text-[10px] font-bold uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold tabular-nums text-primary">{value}</dd>
      {sub && <p className="text-[11px] leading-snug text-muted">{sub}</p>}
    </div>
  );
}

export default function RecoveryCalculator({
  purchase,
  canRecord,
  onClose,
  actionsHost,
}: {
  purchase: any;
  /** Whoever buys palay may record the result; others only calculate. */
  canRecord: boolean;
  onClose: () => void;
  /** The window's footer: the Close and Record buttons are drawn there, so they
   *  stay in one place instead of floating over the fields. Null until it exists. */
  actionsHost: HTMLElement | null;
}) {
  const phone = useIsPhone();
  const lines: any[] = purchase.items ?? [];
  const [lineId, setLineId] = useState<string>(lines[0]?.id ?? "");
  const line = lines.find((l) => l.id === lineId) ?? lines[0];
  // The weights are typed in kilos or grams (a small sample is often weighed in
  // grams) and go to the server in kilos.
  const [unit, setUnit] = useState<WeightUnit>("kg");
  const [sample, setSample] = useState("");
  const [moisture, setMoisture] = useState(() => moistureOf(lines[0]));
  const [milled, setMilled] = useState("");
  const [head, setHead] = useState("");
  const [husk, setHusk] = useState("");
  const [bran, setBran] = useState("");
  const panel = useRef<HTMLElement>(null);
  const unitLabel = useId();
  const refresh = useRefreshPurchases();

  useEffect(() => {
    panel.current?.scrollIntoView?.({ block: "start", behavior: "smooth" });
  }, []);

  const { data: varieties = [] } = useQuery<any[]>({
    queryKey: ["varieties"],
    queryFn: () => paddyService.listVarieties(),
  });
  const variety = varieties.find((v) => v.id === line?.variety_id);

  const moisturePct = parseAmount(moisture);
  const moistureTooHigh = moisturePct != null && moisturePct > 100;
  const kgOf = (text: string) => {
    const n = parseAmount(text);
    return n == null ? null : toKg(n, unit);
  };
  const input: RecoveryInput = {
    sampleKg: kgOf(sample),
    moisturePct: moistureTooHigh ? null : moisturePct,
    milledKg: kgOf(milled),
    headKg: kgOf(head),
    huskKg: kgOf(husk),
    branKg: kgOf(bran),
  };
  const result = computeRecovery(input);
  const problem = recoveryProblem(input);
  const gap = result
    ? recoveryGap(result.recoveryPct, Number(variety?.typical_recovery_pct))
    : null;
  const overweight = result?.notAccountedPct != null && result.notAccountedPct < -0.05;

  const body: RecoveryTestForm | null =
    result && input.sampleKg != null && input.milledKg != null && !moistureTooHigh
      ? {
          variety_id: line?.variety_id ?? null,
          sample_kg: input.sampleKg,
          sample_moisture_pct: input.moisturePct,
          milled_kg: input.milledKg,
          head_rice_kg: input.headKg,
          husk_kg: input.huskKg,
          bran_kg: input.branKg,
        }
      : null;

  const save = useMutation({
    mutationFn: (b: RecoveryTestForm) => paddyService.recordRecovery(purchase.id, b),
    onSuccess: () => {
      refresh();
      onClose();
    },
  });
  const error = (save.error as any)?.response?.data?.detail;

  /** Switch the unit: what's typed is shown again in it, the weights unchanged. */
  const changeUnit = (to: WeightUnit) => {
    if (to === unit) return;
    setSample(convertAmount(sample, unit, to));
    setMilled(convertAmount(milled, unit, to));
    setHead(convertAmount(head, unit, to));
    setHusk(convertAmount(husk, unit, to));
    setBran(convertAmount(bran, unit, to));
    setUnit(to);
  };

  const pickLine = (id: string) => {
    setLineId(id);
    setMoisture(moistureOf(lines.find((l) => l.id === id)));
  };

  return (
    <section
      ref={panel}
      className="mt-4 rounded-2xl bg-slate-50/70 p-4 ring-1 ring-soft dark:bg-slate-800/40"
      aria-label={t("Recovery calculator")}
      data-testid="recovery-calculator"
    >
      {/* The kg / g switch goes under the title on a phone, where beside it the
          title would be squeezed into a sliver. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-2">
          <Calculator size={18} className="mt-0.5 shrink-0 text-brand-600" aria-hidden />
          <div>
            <h4 className="text-sm font-bold text-primary">{t("Recovery calculator")}</h4>
            <p className="text-xs text-muted">
              {t(
                "Mill a small sample of this palay, weigh what comes out, and see how much rice it gives.",
              )}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-xs text-muted">
          <span id={unitLabel}>{t("Weigh in")}</span>
          <div role="radiogroup" aria-labelledby={unitLabel} className="seg">
            {WEIGHT_UNITS.map((u) => (
              <button
                key={u}
                type="button"
                role="radio"
                aria-checked={unit === u}
                className={`seg-btn !px-3 ${unit === u ? "is-active" : ""}`}
                onClick={() => changeUnit(u)}
              >
                {u}
              </button>
            ))}
          </div>
        </div>
      </div>

      {lines.length > 1 && (
        <div className="mt-3">
          <span className="mb-1 block text-xs font-medium text-secondary">{t("Palay tested")}</span>
          <Select
            aria-label={t("Palay tested")}
            value={line?.id ?? ""}
            onChange={pickLine}
            options={lines.map((l) => ({
              value: l.id,
              label: [l.variety_code ?? t("Any variety"), l.grade_code].filter(Boolean).join(" · "),
            }))}
          />
        </div>
      )}

      <div className="mt-3 grid gap-4 md:grid-cols-2">
        <div>
          <div className="grid grid-cols-2 gap-3">
            <Amount
              label={t("Palay sample ({{unit}})", { unit })}
              value={sample}
              onChange={setSample}
              placeholder={unit === "kg" ? t("e.g. 50") : t("e.g. 500")}
              // On a phone the keyboard waits for a tap: opened unasked it covered
              // most of the window.
              autoFocus={!phone}
            />
            <Amount
              label={t("Sample moisture %")}
              value={moisture}
              onChange={setMoisture}
              placeholder={t("Optional")}
            />
            <Amount
              label={t("Milled rice ({{unit}})", { unit })}
              value={milled}
              onChange={setMilled}
              hint={t("All the rice that came out, brokens too.")}
            />
            <Amount
              label={t("Head rice ({{unit}})", { unit })}
              value={head}
              onChange={setHead}
              placeholder={t("Optional")}
              hint={t("The whole grains, at least ¾ of their length.")}
            />
            <Amount
              label={t("Husk ({{unit}})", { unit })}
              value={husk}
              onChange={setHusk}
              placeholder={t("Optional")}
            />
            <Amount
              label={t("Bran ({{unit}})", { unit })}
              value={bran}
              onChange={setBran}
              placeholder={t("Optional")}
            />
          </div>

          {(problem || moistureTooHigh || overweight) && (
            <p role="alert" className="mt-3 text-sm text-rose-600 dark:text-rose-400">
              {problem
                ? PROBLEM_TEXT[problem]()
                : moistureTooHigh
                  ? t("Moisture can't be more than 100%.")
                  : t(
                      "The milled rice, husk and bran add up to more than the palay sample. Check the weights.",
                    )}
            </p>
          )}
        </div>

        <div>
          {result && gap ? (
            <div
              className="rounded-xl bg-white/70 p-4 ring-1 ring-soft dark:bg-slate-900/40"
              aria-live="polite"
              data-testid="recovery-result"
            >
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted">
                {t("Milling recovery")}
              </p>
              <p className="text-3xl font-extrabold tabular-nums text-primary">
                {percent(result.recoveryPct)}
              </p>
              <p className="text-sm text-secondary">
                {Math.abs(gap.points) < 0.05
                  ? t("On target with the usual {{pct}}%.", { pct: gap.usual })
                  : gap.points > 0
                    ? t("{{points}} points above the usual {{pct}}%.", {
                        points: gap.points.toFixed(1),
                        pct: gap.usual,
                      })
                    : t("{{points}} points below the usual {{pct}}%.", {
                        points: Math.abs(gap.points).toFixed(1),
                        pct: gap.usual,
                      })}
              </p>
              <dl className="mt-3 grid grid-cols-2 gap-2">
                <Stat
                  label={t("Rice from a 50 kg cavan")}
                  value={`${result.riceKgPerCavan.toFixed(1)} ${t("kg")}`}
                />
                {result.headOfPalayPct != null && result.headOfMilledPct != null && (
                  <Stat
                    label={t("Head rice")}
                    value={percent(result.headOfPalayPct)}
                    sub={t("{{pct}} of the milled rice", { pct: percent(result.headOfMilledPct) })}
                  />
                )}
                {result.brokenOfMilledPct != null && (
                  <Stat
                    label={t("Broken rice")}
                    value={percent(result.brokenOfMilledPct)}
                    sub={t("of the milled rice")}
                  />
                )}
                {result.huskPct != null && (
                  <Stat label={t("Husk")} value={percent(result.huskPct)} />
                )}
                {result.branPct != null && (
                  <Stat label={t("Bran")} value={percent(result.branPct)} />
                )}
                {result.notAccountedPct != null && (
                  <Stat
                    label={t("Not accounted for")}
                    value={percent(result.notAccountedPct)}
                    sub={t("Moisture driven off, dust and spillage")}
                  />
                )}
                {result.recoveryAt14Pct != null && (
                  <Stat
                    label={t("At 14% moisture")}
                    value={percent(result.recoveryAt14Pct)}
                    sub={t("The palay weighed down to 14% moisture")}
                  />
                )}
              </dl>
            </div>
          ) : (
            <p className="rounded-xl border border-dashed border-soft p-4 text-sm text-muted">
              {t("Enter the palay sample and the milled rice to see the recovery.")}
            </p>
          )}
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-3 text-sm text-rose-600 dark:text-rose-400">
          {typeof error === "string" ? error : t("Couldn't save. Check the fields and try again.")}
        </p>
      )}

      {canRecord && (
        <p className="mt-4 text-xs text-muted">
          {t("Recording saves this result on the purchase. No stock changes.")}
        </p>
      )}

      {/* The window's footer, the one bar that stays at the bottom whatever the
          keyboard does. Not a bar of its own inside the scrolling body, which on a
          phone sat over the fields and, with the keyboard up, hid most of them. */}
      {actionsHost &&
        createPortal(
          <>
            <button
              type="button"
              className="btn-secondary flex-auto sm:flex-none"
              onClick={onClose}
              disabled={save.isPending}
            >
              {t("Close calculator")}
            </button>
            {canRecord && (
              <button
                type="button"
                className="btn-primary flex-auto sm:flex-none"
                onClick={() => body && save.mutate(body)}
                disabled={!body || save.isPending}
              >
                {save.isPending ? t("Saving…") : t("Record result")}
              </button>
            )}
          </>,
          actionsHost,
        )}
    </section>
  );
}

/** The recovery tests saved on a purchase, newest first. Whoever has edit power
 *  can take one off. Shows nothing while there are none. */
export function RecoveryTests({ purchase, canRemove }: { purchase: any; canRemove: boolean }) {
  const tests: any[] = purchase.recovery_tests ?? [];
  const [removing, setRemoving] = useState<any | null>(null);
  const refresh = useRefreshPurchases();
  const remove = useMutation({
    mutationFn: (id: string) => paddyService.removeRecovery(purchase.id, id),
    onSuccess: () => {
      refresh();
      setRemoving(null);
    },
  });
  if (tests.length === 0) return null;

  const headings = [
    t("Date"),
    t("Variety"),
    t("Palay"),
    t("Milled rice"),
    t("Recovery"),
    t("Head rice"),
    t("Recorded by"),
  ];
  return (
    <section className="mt-4" aria-label={t("Recovery tests")} data-testid="recovery-tests">
      <h4 className="mb-2 text-sm font-bold text-primary">{t("Recovery tests")}</h4>
      <div className="rounded-xl ring-1 ring-soft sm:overflow-x-auto">
        <table className="stack-table w-full text-sm sm:[overflow-wrap:normal]">
          <thead className="bg-gray-50 dark:bg-slate-900/50">
            <tr>
              {headings.map((h, i) => (
                <th
                  key={h}
                  className={`px-3 py-2 font-medium text-gray-600 dark:text-slate-300 sm:whitespace-nowrap ${i >= 2 && i <= 5 ? "text-right" : "text-left"}`}
                >
                  {h}
                </th>
              ))}
              {canRemove && <th className="w-10" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
            {tests.map((x) => (
              <tr key={x.id}>
                <td data-label={headings[0]} className="px-3 py-2">
                  {new Date(x.created_at).toLocaleDateString()}
                </td>
                <td data-label={headings[1]} className="px-3 py-2">
                  {x.variety_code ?? "—"}
                </td>
                <td data-label={headings[2]} className="px-3 py-2 text-right tabular-nums">
                  {formatWeight(x.sample_kg)}
                </td>
                <td data-label={headings[3]} className="px-3 py-2 text-right tabular-nums">
                  {formatWeight(x.milled_kg)}
                </td>
                <td
                  data-label={headings[4]}
                  className="px-3 py-2 text-right font-semibold tabular-nums"
                >
                  {percent(Number(x.recovery_pct))}
                </td>
                <td data-label={headings[5]} className="px-3 py-2 text-right tabular-nums">
                  {x.head_rice_pct != null ? percent(Number(x.head_rice_pct)) : "—"}
                </td>
                <td data-label={headings[6]} className="px-3 py-2">
                  {x.created_by_name ?? "—"}
                </td>
                {canRemove && (
                  <td className="px-1 py-1 text-right">
                    <button
                      type="button"
                      className="btn-ghost !p-1.5"
                      aria-label={t("Remove recovery test")}
                      onClick={() => setRemoving(x)}
                    >
                      <Trash2 size={15} aria-hidden />
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ConfirmDialog
        open={removing !== null}
        danger
        busy={remove.isPending}
        title={t("Remove this recovery test?")}
        confirmLabel={t("Remove")}
        onConfirm={() => removing && remove.mutate(removing.id)}
        onCancel={() => setRemoving(null)}
      >
        {removing &&
          t("{{pct}} recovery from a {{sample}} sample. It stays in the purchase's history.", {
            pct: percent(Number(removing.recovery_pct)),
            sample: formatWeight(removing.sample_kg),
          })}
      </ConfirmDialog>
    </section>
  );
}
