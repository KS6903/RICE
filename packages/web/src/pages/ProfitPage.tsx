// The Profit calculator: palay, rice and by-products brought together. From the
// recovery it works out the selling price that doesn't lose money and what that
// price earns, and says so when no price can save the lot. The Boss sees the real
// figures. Anyone the Boss opens the page to gets only a table from the server: the
// recommended price and a lower profit, with no costs to work the real one back from.
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, startOfMonth } from "date-fns";
import { AlertTriangle, Calculator, CheckCircle2, ChevronDown, TrendingUp } from "lucide-react";
import { Amount, Stat } from "../components/buying/RecoveryCalculator";
import { peso } from "../components/buying/money";
import DateRangePicker from "../components/DateRangePicker";
import LoadingRows from "../components/LoadingRows";
import Select from "../components/Select";
import { useAccess } from "../hooks/useAccess";
import { parseAmount, computeRecovery } from "../mappers/RecoveryMapper";
import { DEFAULT_RECOVERY_PCT } from "../mappers/MillingMapper";
import {
  BENCHMARKS,
  estimateByproducts,
  HIGH_RECOVERY_PCT,
  LOW_RECOVERY_PCT,
  pricePlan,
  priceSteps,
  profitAt,
  standardWeight,
  type ByproductEstimate,
  type PricePlan,
} from "../mappers/ProfitMapper";
import {
  profitService,
  type BossVarietyRow,
  type ProfitDefaults,
  type ProfitSettings,
  type ProfitVerdict,
  type StaffVarietyRow,
} from "../services/ProfitService";
import { paddyService } from "../services/PaddyService";
import { varietyOptions } from "../utils/varieties";
import { t } from "../i18n";

const percent = (n: number) => `${n.toFixed(1)}%`;
const kilos = (n: number) =>
  `${n.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${t("kg")}`;
/** A figure read from the records, as it goes in a field. */
const field = (n: number | null | undefined) =>
  n == null ? "" : String(Math.round(n * 100) / 100);

const verdictText = (v: ProfitVerdict): string =>
  ({
    good: t("Good"),
    thin: t("Thin"),
    losing: t("Losing game"),
    no_data: t("No figures yet"),
  })[v];

const VERDICT_BADGE: Record<ProfitVerdict, string> = {
  good: "badge-green",
  thin: "badge-yellow",
  losing: "badge-red",
  no_data: "badge-gray",
};

const sourceText = (d: ProfitDefaults | undefined): string | undefined => {
  if (!d) return undefined;
  return {
    batches: t("From your milling batches, last 90 days"),
    tests: t("From your recovery tests, last 90 days"),
    variety: t("This variety's usual recovery"),
    default: t("The usual {{pct}}%: no batches or tests yet", { pct: DEFAULT_RECOVERY_PCT }),
  }[d.recovery_source];
};

const marketHint = (d: ProfitDefaults | undefined): string => {
  if (d?.market_source === "variety" || d?.market_source === "milled") {
    return t("From your sales of this rice, last 90 days");
  }
  if (d?.market_source === "all") return t("Your average for all rice, last 90 days");
  return t("What buyers pay now. It's how a losing game is spotted.");
};

type Form = {
  palayKg: string;
  palayPrice: string;
  moisture: string;
  recovery: string;
  head: string;
  binlid: string;
  darak: string;
  mata: string;
  ipa: string;
  binlidPrice: string;
  darakPrice: string;
  mataPrice: string;
  ipaPrice: string;
  crhKg: string;
  crhPrice: string;
  tikiKg: string;
  tikiPrice: string;
  dayamiKg: string;
  dayamiPrice: string;
  otherPerKg: string;
  market: string;
};

// Nothing is filled in until someone types or picks a variety: the fields show a grey
// example, and the by-products their estimate from the recovery.
const BLANK: Form = {
  palayKg: "",
  palayPrice: "",
  moisture: "",
  recovery: "",
  head: "",
  binlid: "",
  darak: "",
  mata: "",
  ipa: "",
  binlidPrice: "",
  darakPrice: "",
  mataPrice: "",
  ipaPrice: "",
  crhKg: "",
  crhPrice: "",
  tikiKg: "",
  tikiPrice: "",
  dayamiKg: "",
  dayamiPrice: "",
  otherPerKg: "",
  market: "",
};

/** The by-products a recovery gives, in the order a mill names them. */
const mainByproducts = (): {
  key: keyof ByproductEstimate;
  priceKey: keyof Form;
  name: string;
  example: number;
}[] => [
  { key: "binlid", priceKey: "binlidPrice", name: t("Binlid (Broken Rice)"), example: 18 },
  { key: "darak", priceKey: "darakPrice", name: t("Darak (Rice Bran)"), example: 8 },
  {
    key: "mata",
    priceKey: "mataPrice",
    name: t("Mata-mata (Fine Brokens / Rice Grits)"),
    example: 12,
  },
  { key: "ipa", priceKey: "ipaPrice", name: t("Ipa (Rice Husk / Hull)"), example: 1 },
];

/** The by-products only some mills have, behind a button: counted in kilos if present,
 *  nothing if not, and never estimated. */
const moreByproducts = (): { kgKey: keyof Form; priceKey: keyof Form; name: string }[] => [
  {
    kgKey: "crhKg",
    priceKey: "crhPrice",
    name: t("Carbonized Rice Hull (CRH) (Partially Burned Husk)"),
  },
  { kgKey: "tikiKg", priceKey: "tikiPrice", name: t("Tiki-Tiki (Food-Grade Fine Bran)") },
  { kgKey: "dayamiKg", priceKey: "dayamiPrice", name: t("Dayami (Rice Straw)") },
];

const example = (value: number) => t("e.g. {{value}}", { value });

/** What the records fill in for a variety. Without batches to read them from, the
 *  by-product shares stay empty and show their estimate. */
const fromRecords = (d: ProfitDefaults): Form => {
  const weighed = d.yields_source === "batches";
  return {
    ...BLANK,
    palayKg: field(d.palay_kg),
    palayPrice: field(d.palay_price),
    moisture: field(d.moisture_pct),
    recovery: field(d.recovery_pct),
    head: field(d.head_pct),
    binlid: weighed ? field(d.binlid_pct) : "",
    darak: weighed ? field(d.darak_pct) : "",
    mata: weighed ? field(d.mata_mata_pct) : "",
    ipa: weighed ? field(d.ipa_pct) : "",
    binlidPrice: field(d.binlid_price),
    darakPrice: field(d.darak_price),
    mataPrice: field(d.mata_mata_price),
    ipaPrice: field(d.ipa_price),
    otherPerKg: d.other_cost_per_kg > 0 ? field(d.other_cost_per_kg) : "",
    market: field(d.market_price),
  };
};

function VerdictNote({
  plan,
  targetPct,
  hasMarket,
}: {
  plan: PricePlan;
  targetPct: number;
  hasMarket: boolean;
}) {
  if (plan.verdict === "losing") {
    const needed = plan.recoveryNeededPct as number;
    return (
      <div
        role="alert"
        className="mt-3 flex gap-2 rounded-xl bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950/40 dark:text-rose-200"
      >
        <AlertTriangle size={18} className="mt-0.5 shrink-0" aria-hidden />
        <div>
          <p className="font-bold">
            {t("This is a losing game at this recovery and palay price.")}
          </p>
          <p className="mt-1">
            {t("At what the market pays, you lose {{loss}} on every kilo of rice.", {
              loss: peso(plan.lossPerKg as number),
            })}{" "}
            {needed <= HIGH_RECOVERY_PCT
              ? t(
                  "To break even, recovery must reach {{pct}}, or the palay must cost at most {{price}} a kilo.",
                  {
                    pct: percent(needed),
                    price: peso(plan.maxPalayPrice as number),
                  },
                )
              : t(
                  "No normal recovery can fix this. The palay must cost at most {{price}} a kilo.",
                  {
                    price: peso(plan.maxPalayPrice as number),
                  },
                )}
          </p>
        </div>
      </div>
    );
  }
  if (plan.verdict === "thin") {
    return (
      <p className="mt-3 flex gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
        <AlertTriangle size={18} className="mt-0.5 shrink-0" aria-hidden />
        {t("You make money at this price, but less than your {{pct}}% target.", { pct: targetPct })}
      </p>
    );
  }
  return (
    <p className="mt-3 flex gap-2 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
      <CheckCircle2 size={18} className="mt-0.5 shrink-0" aria-hidden />
      {hasMarket
        ? t("You won't lose money at this price, and it meets your {{pct}}% target.", {
            pct: targetPct,
          })
        : t(
            "You won't lose money at this price. Enter what the market pays to check that buyers will pay it.",
          )}
    </p>
  );
}

function Calculate({ settings }: { settings: ProfitSettings }) {
  const [varietyId, setVarietyId] = useState("");
  const [form, setForm] = useState<Form>(BLANK);
  const [sellAt, setSellAt] = useState("");
  const [showMore, setShowMore] = useState(false);
  const set = (key: keyof Form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  const { data: varieties = [] } = useQuery<any[]>({
    queryKey: ["varieties"],
    queryFn: () => paddyService.listVarieties(),
  });
  const { data: records } = useQuery({
    queryKey: ["profit-defaults", varietyId],
    queryFn: () => profitService.defaults(varietyId),
    enabled: varietyId !== "",
  });
  useEffect(() => {
    if (!records) return;
    setForm(fromRecords(records));
    setSellAt("");
  }, [records]);

  const n = (text: string) => parseAmount(text) ?? 0;
  const palayKg = n(form.palayKg);
  const recoveryPct = n(form.recovery);
  const moisturePct = parseAmount(form.moisture);
  const market = parseAmount(form.market);
  const main = mainByproducts();
  const more = moreByproducts();
  // Until the real share is typed, each by-product comes from the recovery.
  const estimate = recoveryPct > 0 ? estimateByproducts(recoveryPct) : null;
  const typedShare = (key: keyof ByproductEstimate) => parseAmount(form[key]);
  const shareOf = (key: keyof ByproductEstimate) => typedShare(key) ?? estimate?.[key] ?? 0;
  const anyEstimated = estimate != null && main.some((b) => typedShare(b.key) == null);
  const plan = pricePlan({
    palayKg,
    palayPrice: n(form.palayPrice),
    moisturePct,
    recoveryPct,
    otherCosts: palayKg * n(form.otherPerKg),
    byproducts: main.map((b) => ({ pct: shareOf(b.key), price: n(form[b.priceKey]) })),
    extraIncome: more.reduce((sum, b) => sum + n(form[b.kgKey]) * n(form[b.priceKey]), 0),
    targetMarginPct: settings.target_margin_pct,
    marketPrice: market,
  });
  // The milling audit, per 100 kg of palay at 14% moisture.
  const audit = computeRecovery({
    sampleKg: 100,
    moisturePct: null,
    milledKg: recoveryPct,
    headKg: parseAmount(form.head),
    huskKg: shareOf("ipa"),
    branKg: shareOf("darak"),
  });
  const headTooMuch = parseAmount(form.head) != null && n(form.head) > recoveryPct;
  const typedPrice = parseAmount(sellAt);
  const typedProfit = plan && typedPrice != null ? profitAt(plan, typedPrice) : null;

  return (
    <section
      className="card space-y-4"
      aria-label={t("Calculator")}
      data-testid="profit-calculator"
    >
      <div>
        <h3 className="flex items-center gap-2 text-sm font-bold text-primary">
          <Calculator size={18} className="text-brand-600" aria-hidden />
          {t("What should I sell it for?")}
        </h3>
        <p className="mt-1 text-xs text-muted">
          {t(
            "Pick a variety to fill this in from your records, or type your own numbers. Nothing here is saved.",
          )}
        </p>
      </div>

      <div className="max-w-sm">
        <span className="mb-1 block text-xs font-medium text-secondary">{t("Variety")}</span>
        <Select
          aria-label={t("Variety")}
          value={varietyId}
          onChange={setVarietyId}
          options={varietyOptions(varieties, "palay")}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <div>
            <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-muted">
              {t("The palay")}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Amount
                label={t("Palay (kg)")}
                value={form.palayKg}
                onChange={set("palayKg")}
                placeholder={example(1000)}
              />
              <Amount
                label={t("Palay price per kg (₱)")}
                value={form.palayPrice}
                onChange={set("palayPrice")}
                placeholder={example(20)}
              />
              <Amount
                label={t("Moisture %")}
                value={form.moisture}
                onChange={set("moisture")}
                placeholder={t("Optional")}
              />
              <Amount
                label={t("Other costs per kg of palay (₱)")}
                value={form.otherPerKg}
                onChange={set("otherPerKg")}
                placeholder={example(1)}
                hint={t("Drying, labor, power: what milling costs you.")}
              />
            </div>
          </div>
          <div>
            <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-muted">
              {t("What it gives (% of the palay)")}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Amount
                label={t("Milling recovery %")}
                value={form.recovery}
                onChange={set("recovery")}
                placeholder={example(DEFAULT_RECOVERY_PCT)}
                hint={sourceText(records)}
              />
              <Amount
                label={t("Head rice %")}
                value={form.head}
                onChange={set("head")}
                placeholder={t("Optional")}
                hint={t("The whole grains, at least ¾ of their length.")}
              />
            </div>
            <p className="mt-3 text-xs text-muted">
              {estimate
                ? t(
                    "The by-products are estimated from the recovery. Type the real share if you weighed it.",
                  )
                : t("Enter the recovery and the by-products are estimated for you.")}
            </p>
            <div className="mt-2 grid grid-cols-2 gap-3" data-testid="byproduct-shares">
              {main.map((b) => {
                const estimated = estimate && typedShare(b.key) == null;
                const kg = (standardWeight(palayKg, moisturePct) * shareOf(b.key)) / 100;
                return (
                  <Amount
                    key={b.key}
                    label={`${b.name} %`}
                    value={form[b.key]}
                    onChange={set(b.key)}
                    placeholder={estimate ? field(estimate[b.key]) : t("Auto")}
                    hint={
                      estimated
                        ? palayKg > 0
                          ? t("Estimate only: about {{amount}}", { amount: kilos(kg) })
                          : t("Estimate only")
                        : undefined
                    }
                  />
                );
              })}
            </div>
          </div>
          <div>
            <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-muted">
              {t("What you sell for")}
            </p>
            <div className="grid grid-cols-2 gap-3">
              {main.map((b) => (
                <Amount
                  key={b.key}
                  label={t("{{name}} per kg (₱)", { name: b.name })}
                  value={form[b.priceKey]}
                  onChange={set(b.priceKey)}
                  placeholder={example(b.example)}
                />
              ))}
            </div>
            <button
              type="button"
              className="btn-secondary mt-3"
              aria-expanded={showMore}
              onClick={() => setShowMore((open) => !open)}
            >
              {showMore ? t("Hide other by-products") : t("Other by-products")}
              <ChevronDown
                size={16}
                aria-hidden
                className={`transition-transform ${showMore ? "rotate-180" : ""}`}
              />
            </button>
            {showMore && (
              <div className="mt-3 space-y-3" data-testid="more-byproducts">
                <p className="text-xs text-muted">
                  {t("Only if you have them. Leave them empty if you don't.")}
                </p>
                {more.map((b) => (
                  <div key={b.kgKey}>
                    <p className="mb-1 text-xs font-semibold text-secondary">{b.name}</p>
                    <div className="grid grid-cols-2 gap-3">
                      <Amount
                        label={t("{{name}} (kg)", { name: b.name })}
                        value={form[b.kgKey]}
                        onChange={set(b.kgKey)}
                        placeholder="0"
                      />
                      <Amount
                        label={t("{{name}} per kg (₱)", { name: b.name })}
                        value={form[b.priceKey]}
                        onChange={set(b.priceKey)}
                        placeholder="0"
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-3 max-w-[50%] sm:max-w-[33%]">
              <Amount
                label={t("Market price of rice per kg (₱)")}
                value={form.market}
                onChange={set("market")}
                placeholder={t("Optional")}
                hint={marketHint(records)}
              />
            </div>
          </div>
        </div>

        <div aria-live="polite">
          {plan ? (
            <div data-testid="profit-result">
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted">
                {t("Recommended selling price")}
              </p>
              <p className="text-3xl font-extrabold tabular-nums text-primary">
                {peso(plan.recommendedPrice)}{" "}
                <span className="text-base font-semibold">{t("per kg")}</span>
              </p>
              <dl className="mt-3 grid grid-cols-2 gap-2">
                <Stat label={t("Break-even price")} value={peso(plan.breakEven)} />
                <Stat
                  label={plan.profit >= 0 ? t("Profit at that price") : t("Loss at that price")}
                  value={peso(Math.abs(plan.profit))}
                  sub={t("{{pct}} margin", { pct: percent(plan.marginPct) })}
                />
                <Stat label={t("Rice you get")} value={kilos(plan.riceKg)} />
                <Stat
                  label={t("By-products bring in")}
                  value={peso(plan.byproductIncome)}
                  sub={
                    anyEstimated
                      ? t("An estimate, taken off the rice's cost")
                      : t("Taken off the rice's cost")
                  }
                />
              </dl>
              <VerdictNote
                plan={plan}
                targetPct={settings.target_margin_pct}
                hasMarket={market != null}
              />
              {(recoveryPct < LOW_RECOVERY_PCT || recoveryPct > HIGH_RECOVERY_PCT) && (
                <p
                  className="mt-2 text-sm text-amber-700 dark:text-amber-300"
                  data-testid="recovery-warning"
                >
                  {recoveryPct < LOW_RECOVERY_PCT
                    ? t(
                        "A recovery under {{pct}}% is low. Check the machine, the drying and the weights.",
                        {
                          pct: LOW_RECOVERY_PCT,
                        },
                      )
                    : t(
                        "A recovery over {{pct}}% is about the most palay can give. Check the weights.",
                        {
                          pct: HIGH_RECOVERY_PCT,
                        },
                      )}
                </p>
              )}

              <div className="mt-4 max-w-[50%]">
                <Amount
                  label={t("Sell at (₱ per kg)")}
                  value={sellAt}
                  onChange={setSellAt}
                  placeholder={example(40)}
                />
              </div>
              {typedProfit != null && (
                <p
                  data-testid="sell-at-result"
                  className={`mt-2 text-sm font-semibold tabular-nums ${typedProfit >= 0 ? "text-emerald-700 dark:text-emerald-300" : "text-rose-600 dark:text-rose-400"}`}
                >
                  {typedProfit >= 0
                    ? t("{{amount}} profit", { amount: peso(typedProfit) })
                    : t("{{amount}} loss", { amount: peso(-typedProfit) })}
                </p>
              )}

              <div className="mt-4 rounded-xl ring-1 ring-soft sm:overflow-x-auto">
                <table className="w-full text-sm" data-testid="price-steps">
                  <thead className="bg-gray-50 dark:bg-slate-900/50">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-slate-300">
                        {t("If you sell at")}
                      </th>
                      <th className="px-3 py-2 text-right font-medium text-gray-600 dark:text-slate-300">
                        {t("You make")}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                    {priceSteps(plan).map((p) => {
                      const made = profitAt(plan, p);
                      return (
                        <tr key={p} className={p === plan.recommendedPrice ? "font-semibold" : ""}>
                          <td className="px-3 py-2 tabular-nums">{peso(p)}</td>
                          <td
                            className={`px-3 py-2 text-right tabular-nums ${made < 0 ? "text-rose-600 dark:text-rose-400" : ""}`}
                          >
                            {made < 0 ? `-${peso(-made)}` : peso(made)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <p className="rounded-xl border border-dashed border-soft p-4 text-sm text-muted">
              {t("Enter the palay, its price and the recovery to see the selling price.")}
            </p>
          )}
        </div>
      </div>

      {headTooMuch && (
        <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">
          {t("The head rice is part of the milled rice, so it can't be more than the recovery.")}
        </p>
      )}

      {audit && (
        <div data-testid="milling-audit">
          <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-muted">
            {t("Milling audit, against the usual ranges")}
          </p>
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <Stat
              label={t("Milling recovery")}
              value={percent(audit.recoveryPct)}
              sub={t("Usual {{range}}", { range: BENCHMARKS.milled })}
            />
            {audit.headOfPalayPct != null && audit.headOfMilledPct != null && (
              <>
                <Stat
                  label={t("Head rice recovery")}
                  value={percent(audit.headOfPalayPct)}
                  sub={t("Usual {{range}}", { range: BENCHMARKS.head })}
                />
                <Stat
                  label={t("Head rice index")}
                  value={percent(audit.headOfMilledPct)}
                  sub={t("Of the milled rice")}
                />
                <Stat
                  label={t("Broken rice")}
                  value={percent(audit.recoveryPct - audit.headOfPalayPct)}
                  sub={t("Usual {{range}}", { range: BENCHMARKS.broken })}
                />
              </>
            )}
            <Stat
              label={t("Ipa (Rice Husk / Hull)")}
              value={percent(shareOf("ipa"))}
              sub={t("Usual {{range}}", { range: BENCHMARKS.husk })}
            />
            <Stat
              label={t("Darak (Rice Bran)")}
              value={percent(shareOf("darak"))}
              sub={t("Usual {{range}}", { range: BENCHMARKS.bran })}
            />
            {shareOf("binlid") > 0 && (
              <Stat label={t("Binlid (Broken Rice)")} value={percent(shareOf("binlid"))} />
            )}
            {shareOf("mata") > 0 && (
              <Stat
                label={t("Mata-mata (Fine Brokens / Rice Grits)")}
                value={percent(shareOf("mata"))}
              />
            )}
            <Stat
              label={t("Not accounted for")}
              value={percent(
                100 -
                  recoveryPct -
                  shareOf("ipa") -
                  shareOf("darak") -
                  shareOf("binlid") -
                  shareOf("mata"),
              )}
              sub={t("Usual {{range}}", { range: BENCHMARKS.loss })}
            />
            {plan && plan.standardKg !== palayKg && (
              <Stat
                label={t("Palay at 14% moisture")}
                value={kilos(plan.standardKg)}
                sub={t("What the percentages are taken from")}
              />
            )}
          </dl>
        </div>
      )}
    </section>
  );
}

function BossVarieties() {
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["profit-varieties"],
    queryFn: () => profitService.varieties<BossVarietyRow>(),
  });
  const headings = [
    t("Variety"),
    t("Recovery"),
    t("Break-even"),
    t("Market"),
    t("Recommended"),
    t("Status"),
  ];
  return (
    <section className="space-y-2" data-testid="profit-varieties" aria-label={t("By variety")}>
      <h3 className="text-sm font-bold text-primary">{t("By variety, from the last 90 days")}</h3>
      <div className="card overflow-hidden p-0 sm:overflow-x-auto">
        {isLoading ? (
          <LoadingRows rows={2} />
        ) : rows.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted">
            {t(
              "No palay bought in the last 90 days. Purchases you record show up here by variety.",
            )}
          </p>
        ) : (
          <table className="stack-table w-full text-sm">
            <thead className="bg-gray-50 dark:bg-slate-900/50">
              <tr>
                {headings.map((h, i) => (
                  <th
                    key={h}
                    className={`px-3 py-2 font-medium text-gray-600 dark:text-slate-300 ${i === 0 || i === 5 ? "text-left" : "text-right"}`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
              {rows.map((r) => (
                <tr key={r.variety_id}>
                  <td data-label={headings[0]} className="px-3 py-2" title={r.name}>
                    {r.code}
                  </td>
                  <td data-label={headings[1]} className="px-3 py-2 text-right tabular-nums">
                    {percent(r.recovery_pct)}
                  </td>
                  <td data-label={headings[2]} className="px-3 py-2 text-right tabular-nums">
                    {r.break_even != null ? peso(r.break_even) : "—"}
                  </td>
                  <td data-label={headings[3]} className="px-3 py-2 text-right tabular-nums">
                    {r.market_price != null ? peso(r.market_price) : "—"}
                  </td>
                  <td
                    data-label={headings[4]}
                    className="px-3 py-2 text-right font-semibold tabular-nums"
                  >
                    {r.recommended_price != null ? peso(r.recommended_price) : "—"}
                  </td>
                  <td data-label={headings[5]} className="px-3 py-2">
                    <span className={VERDICT_BADGE[r.verdict]}>{verdictText(r.verdict)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

function Period() {
  const [start, setStart] = useState(format(startOfMonth(new Date()), "yyyy-MM-dd"));
  const [end, setEnd] = useState(format(new Date(), "yyyy-MM-dd"));
  const { data, isLoading } = useQuery({
    queryKey: ["profit-period", start, end],
    queryFn: () => profitService.period(start, end),
    enabled: start !== "" && end !== "",
  });
  const goodName = { palay: t("Palay"), rice: t("Rice"), byproduct: t("By-products") };
  const headings = [t("Good"), t("Sold"), t("Sales"), t("Estimated cost"), t("Profit")];
  const signed = (n: number) => (n < 0 ? `-${peso(-n)}` : peso(Math.abs(n)));
  return (
    <section className="space-y-2" data-testid="profit-period" aria-label={t("This period")}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-bold text-primary">
            <TrendingUp size={16} className="text-brand-600" aria-hidden />
            {t("What each good earned")}
          </h3>
          <p className="text-xs text-muted">
            {t(
              "Invoiced and paid sales. The cost is an estimate: each kilo sold at what that good has cost you lately.",
            )}
          </p>
        </div>
        <DateRangePicker
          aria-label={t("Period")}
          start={start}
          end={end}
          onChange={(from, to) => {
            setStart(from);
            setEnd(to);
          }}
          className="w-full sm:w-72"
        />
      </div>
      <div className="card overflow-hidden p-0 sm:overflow-x-auto">
        {isLoading || !data ? (
          <LoadingRows rows={3} />
        ) : (
          <table className="stack-table w-full text-sm">
            <thead className="bg-gray-50 dark:bg-slate-900/50">
              <tr>
                {headings.map((h, i) => (
                  <th
                    key={h}
                    className={`px-3 py-2 font-medium text-gray-600 dark:text-slate-300 ${i === 0 ? "text-left" : "text-right"}`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
              {data.goods.map((g) => (
                <tr key={g.good}>
                  <td data-label={headings[0]} className="px-3 py-2">
                    {goodName[g.good]}
                  </td>
                  <td data-label={headings[1]} className="px-3 py-2 text-right tabular-nums">
                    {kilos(g.kg_sold)}
                  </td>
                  <td data-label={headings[2]} className="px-3 py-2 text-right tabular-nums">
                    {peso(g.sales)}
                  </td>
                  <td data-label={headings[3]} className="px-3 py-2 text-right tabular-nums">
                    {g.cost != null ? peso(g.cost) : "—"}
                  </td>
                  <td
                    data-label={headings[4]}
                    className="px-3 py-2 text-right font-semibold tabular-nums"
                  >
                    {g.profit != null ? signed(g.profit) : "—"}
                  </td>
                </tr>
              ))}
              <tr>
                <td data-label={headings[0]} className="px-3 py-2">
                  {t("Overhead")}
                </td>
                <td data-label={headings[1]} className="px-3 py-2 text-right">
                  —
                </td>
                <td data-label={headings[2]} className="px-3 py-2 text-right">
                  —
                </td>
                <td data-label={headings[3]} className="px-3 py-2 text-right tabular-nums">
                  {peso(data.overhead)}
                </td>
                <td
                  data-label={headings[4]}
                  className="px-3 py-2 text-right font-semibold tabular-nums"
                >
                  {signed(-data.overhead)}
                </td>
              </tr>
              <tr className="bg-gray-50 font-bold dark:bg-slate-900/50" data-testid="period-total">
                <td data-label={headings[0]} className="px-3 py-2">
                  {t("Total")}
                </td>
                <td data-label={headings[1]} className="px-3 py-2 text-right">
                  —
                </td>
                <td data-label={headings[2]} className="px-3 py-2 text-right">
                  —
                </td>
                <td data-label={headings[3]} className="px-3 py-2 text-right">
                  —
                </td>
                <td
                  data-label={headings[4]}
                  className={`px-3 py-2 text-right tabular-nums ${data.total_profit < 0 ? "text-rose-600 dark:text-rose-400" : ""}`}
                >
                  {signed(data.total_profit)}
                </td>
              </tr>
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

function SettingsCard({ settings }: { settings: ProfitSettings }) {
  const qc = useQueryClient();
  const [target, setTarget] = useState(String(settings.target_margin_pct));
  const [staff, setStaff] = useState(String(settings.staff_profit_pct));
  const targetPct = parseAmount(target);
  const staffPct = parseAmount(staff);
  const valid = targetPct != null && targetPct <= 90 && staffPct != null && staffPct <= 100;
  const changed =
    targetPct !== settings.target_margin_pct || staffPct !== settings.staff_profit_pct;
  const save = useMutation({
    mutationFn: () =>
      profitService.saveSettings({
        target_margin_pct: targetPct as number,
        staff_profit_pct: staffPct as number,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["profit-settings"] });
      qc.invalidateQueries({ queryKey: ["profit-varieties"] });
    },
  });
  return (
    <section
      className="card space-y-3"
      aria-label={t("Profit settings")}
      data-testid="profit-settings"
    >
      <h3 className="text-sm font-bold text-primary">{t("Your settings")}</h3>
      <div className="grid max-w-xl gap-3 sm:grid-cols-2">
        <Amount
          label={t("Target margin %")}
          value={target}
          onChange={setTarget}
          hint={t("How much of the selling price you want to keep. Up to 90%.")}
        />
        <Amount
          label={t("Profit shown to staff, % of the real one")}
          value={staff}
          onChange={setStaff}
          hint={t(
            "Staff you open this page to see this share of the real profit, as an estimate. Don't use their figure for pay or commission.",
          )}
        />
      </div>
      {save.isError && (
        <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">
          {t("Couldn't save. Check the fields and try again.")}
        </p>
      )}
      <button
        type="button"
        className="btn-primary"
        disabled={!valid || !changed || save.isPending}
        onClick={() => save.mutate()}
      >
        {save.isPending ? t("Saving…") : t("Save changes")}
      </button>
    </section>
  );
}

/** What staff get: the price to sell at, and the server's lower figure. */
function StaffView() {
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["profit-varieties"],
    queryFn: () => profitService.varieties<StaffVarietyRow>(),
  });
  const headings = [
    t("Variety"),
    t("Recovery"),
    t("Recommended price"),
    t("Estimated profit per kg"),
    t("Status"),
  ];
  return (
    <section className="card overflow-hidden p-0 sm:overflow-x-auto" data-testid="profit-staff">
      {isLoading ? (
        <LoadingRows rows={2} />
      ) : rows.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted">
          {t("No palay bought in the last 90 days. Purchases you record show up here by variety.")}
        </p>
      ) : (
        <table className="stack-table w-full text-sm">
          <thead className="bg-gray-50 dark:bg-slate-900/50">
            <tr>
              {headings.map((h, i) => (
                <th
                  key={h}
                  className={`px-3 py-2 font-medium text-gray-600 dark:text-slate-300 ${i === 0 || i === 4 ? "text-left" : "text-right"}`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
            {rows.map((r) => (
              <tr key={r.variety_id}>
                <td data-label={headings[0]} className="px-3 py-2" title={r.name}>
                  {r.code}
                </td>
                <td data-label={headings[1]} className="px-3 py-2 text-right tabular-nums">
                  {percent(r.recovery_pct)}
                </td>
                <td
                  data-label={headings[2]}
                  className="px-3 py-2 text-right font-semibold tabular-nums"
                >
                  {r.recommended_price != null ? peso(r.recommended_price) : "—"}
                </td>
                <td data-label={headings[3]} className="px-3 py-2 text-right tabular-nums">
                  {r.estimated_profit_per_kg != null ? peso(r.estimated_profit_per_kg) : "—"}
                </td>
                <td data-label={headings[4]} className="px-3 py-2">
                  <span className={VERDICT_BADGE[r.verdict]}>{verdictText(r.verdict)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export default function ProfitPage() {
  const { role } = useAccess();
  const boss = role === "owner";
  const { data: settings } = useQuery({
    queryKey: ["profit-settings"],
    queryFn: () => profitService.settings(),
    enabled: boss,
  });
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-900 dark:text-slate-100">
          {t("Profit calculator")}
        </h2>
        <p className="text-sm text-gray-500 dark:text-slate-400">
          {boss
            ? t("Palay, rice and by-products together: the price to sell at, and what it earns")
            : t("The price to sell at for each variety, and an estimate of what it earns")}
        </p>
      </div>
      {!boss ? (
        <StaffView />
      ) : settings ? (
        <>
          <Calculate settings={settings} />
          <BossVarieties />
          <Period />
          <SettingsCard settings={settings} />
        </>
      ) : (
        <LoadingRows rows={4} />
      )}
    </div>
  );
}
