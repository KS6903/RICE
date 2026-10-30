// The recovery calculator inside a palay purchase's window. A small sample of the
// palay is milled and weighed with every part that comes out of it, and the
// calculator shows the recovery rate, the head rice and broken rice, the husk
// and the bran. The result can be recorded on the purchase, or the calculator
// just closed. The formulas, with their sources, are in mappers/RecoveryMapper.ts.
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Calculator, Trash2 } from "lucide-react";
import ConfirmDialog from "../ConfirmDialog";
import Select from "../Select";
import {
  computeRecovery,
  parseAmount,
  recoveryGap,
  recoveryProblem,
  type RecoveryInput,
  type RecoveryProblem,
} from "../../mappers/RecoveryMapper";
import { paddyService, type RecoveryTestForm } from "../../services/PaddyService";
import { t } from "../../i18n";

const percent = (n: number) => `${n.toFixed(1)}%`;
const kg = (v: unknown) => `${Number(v ?? 0).toLocaleString()} ${t("kg")}`;

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

function Amount({
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

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
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
}: {
  purchase: any;
  /** Whoever buys palay may record the result; others only calculate. */
  canRecord: boolean;
  onClose: () => void;
}) {
  const lines: any[] = purchase.items ?? [];
  const [lineId, setLineId] = useState<string>(lines[0]?.id ?? "");
  const line = lines.find((l) => l.id === lineId) ?? lines[0];
  const [sample, setSample] = useState("");
  const [moisture, setMoisture] = useState(() => moistureOf(lines[0]));
  const [milled, setMilled] = useState("");
  const [head, setHead] = useState("");
  const [husk, setHusk] = useState("");
  const [bran, setBran] = useState("");
  const panel = useRef<HTMLElement>(null);
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
  const input: RecoveryInput = {
    sampleKg: parseAmount(sample),
    moisturePct: moistureTooHigh ? null : moisturePct,
    milledKg: parseAmount(milled),
    headKg: parseAmount(head),
    huskKg: parseAmount(husk),
    branKg: parseAmount(bran),
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
              label={t("Palay sample (kg)")}
              value={sample}
              onChange={setSample}
              placeholder={t("e.g. 50")}
              autoFocus
            />
            <Amount
              label={t("Moisture of the sample %")}
              value={moisture}
              onChange={setMoisture}
              placeholder={t("Optional")}
            />
            <Amount
              label={t("Milled rice (kg)")}
              value={milled}
              onChange={setMilled}
              hint={t("All the rice that came out, brokens too.")}
            />
            <Amount
              label={t("Head rice (kg)")}
              value={head}
              onChange={setHead}
              placeholder={t("Optional")}
              hint={t("The whole grains, at least ¾ of their length.")}
            />
            <Amount
              label={t("Husk (kg)")}
              value={husk}
              onChange={setHusk}
              placeholder={t("Optional")}
            />
            <Amount
              label={t("Bran (kg)")}
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

      <div className="sticky -bottom-4 -mx-4 -mb-4 mt-4 flex flex-wrap items-center justify-end gap-2 rounded-b-2xl border-t border-soft bg-[rgb(var(--surface-raised))] px-4 py-3">
        {canRecord && (
          <p className="mr-auto text-xs text-muted">
            {t("Recording saves this result on the purchase. No stock changes.")}
          </p>
        )}
        <button type="button" className="btn-secondary" onClick={onClose} disabled={save.isPending}>
          {t("Close calculator")}
        </button>
        {canRecord && (
          <button
            type="button"
            className="btn-primary"
            onClick={() => body && save.mutate(body)}
            disabled={!body || save.isPending}
          >
            {save.isPending ? t("Saving…") : t("Record result")}
          </button>
        )}
      </div>
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
      <div className="overflow-x-auto rounded-xl ring-1 ring-soft">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-slate-900/50">
            <tr>
              {headings.map((h, i) => (
                <th
                  key={h}
                  className={`px-3 py-2 font-medium text-gray-600 dark:text-slate-300 ${i >= 2 && i <= 5 ? "text-right" : "text-left"}`}
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
                <td className="px-3 py-2">{new Date(x.created_at).toLocaleDateString()}</td>
                <td className="px-3 py-2">{x.variety_code ?? "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{kg(x.sample_kg)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{kg(x.milled_kg)}</td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums">
                  {percent(Number(x.recovery_pct))}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {x.head_rice_pct != null ? percent(Number(x.head_rice_pct)) : "—"}
                </td>
                <td className="px-3 py-2">{x.created_by_name ?? "—"}</td>
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
            sample: kg(removing.sample_kg),
          })}
      </ConfirmDialog>
    </section>
  );
}
