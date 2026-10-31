// The Savings page: every place a mill loses money, in one tab under Money, with what
// each is costing now. The sums are on the server (services/savings_service.py) and the
// figures are the Boss's alone, as the Profit calculator's are.
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  AlertTriangle,
  Blend as BlendIcon,
  Boxes,
  Gauge,
  HandCoins,
  LayoutGrid,
  Scale,
  ShieldAlert,
  Wheat,
  type LucideIcon,
} from "lucide-react";
import { peso } from "../components/buying/money";
import EmptyState from "../components/EmptyState";
import FieldCaption from "../components/FieldCaption";
import LoadingRows from "../components/LoadingRows";
import PiggyBankIcon from "../components/PiggyBankIcon";
import Select from "../components/Select";
import { useAccess } from "../hooks/useAccess";
import { useFeature } from "../hooks/useFeature";
import { blend } from "../mappers/SavingsMapper";
import { paddyService } from "../services/PaddyService";
import {
  savingsService,
  type BatchRow,
  type HoldReason,
  type SavingsSettings,
  type UtilizationBand,
} from "../services/SavingsService";
import { t } from "../i18n";

const kilos = (n: number) =>
  `${n.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${t("kg")}`;
const percent = (n: number | null | undefined) => (n == null ? "—" : `${n.toFixed(1)}%`);
const pesoOr = (n: number | null | undefined) => (n == null ? "—" : peso(n));
const apiDetail = (error: unknown): string | null => {
  const detail = (error as any)?.response?.data?.detail;
  if (!error) return null;
  return typeof detail === "string" ? detail : t("Couldn't save. Check the fields and try again.");
};

type Tab = "overview" | "buying" | "milling" | "warehouse" | "costs" | "vale";

const TABS: { key: Tab; label: () => string; icon: LucideIcon }[] = [
  { key: "overview", label: () => t("Overview"), icon: LayoutGrid },
  { key: "buying", label: () => t("Buying"), icon: Wheat },
  { key: "milling", label: () => t("Milling"), icon: Scale },
  { key: "warehouse", label: () => t("Warehouse"), icon: Boxes },
  { key: "costs", label: () => t("Cost and capacity"), icon: Gauge },
  { key: "vale", label: () => t("Vale"), icon: HandCoins },
];

const BAND_TEXT = (band: UtilizationBand): string =>
  ({
    no_data: t("Set machine capacity"),
    below_break_even: t("Below break-even"),
    above_break_even: t("Above break-even"),
    optimal: t("In the target range"),
    over_target: t("Above the target range"),
  })[band];

const BAND_BADGE: Record<UtilizationBand, string> = {
  no_data: "badge-gray",
  below_break_even: "badge-red",
  above_break_even: "badge-yellow",
  optimal: "badge-green",
  over_target: "badge-yellow",
};

const REASONS = (): { value: HoldReason; label: string }[] => [
  { value: "moisture", label: t("High moisture") },
  { value: "pests", label: t("Pests (bukbok)") },
  { value: "mould", label: t("Mould or yellowing") },
  { value: "contaminant", label: t("Contaminant") },
  { value: "other", label: t("Other") },
];

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="card space-y-4">
      <div>
        <h3 className="font-semibold text-primary">{title}</h3>
        {hint && <p className="text-sm text-secondary">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b border-gray-200 dark:border-slate-700">
          <tr>
            {head.map((h) => (
              <th
                key={h}
                className="px-3 py-2 text-left font-medium text-gray-600 dark:text-slate-300 whitespace-nowrap"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-slate-800">{children}</tbody>
      </table>
    </div>
  );
}

const Cell = ({ children, strong }: { children: ReactNode; strong?: boolean }) => (
  <td className={`px-3 py-2 whitespace-nowrap ${strong ? "font-semibold text-primary" : ""}`}>
    {children}
  </td>
);

/** A number the Boss keeps: saved when the field is left. */
function SettingField({
  label,
  name,
  settings,
  onSave,
}: {
  label: string;
  name: keyof SavingsSettings;
  settings: SavingsSettings;
  onSave: (patch: Partial<SavingsSettings>) => void;
}) {
  const saved = settings[name];
  const [value, setValue] = useState(saved == null ? "" : String(saved));
  return (
    <FieldCaption label={label}>
      <input
        className="input"
        type="number"
        min={0}
        step="any"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          const next = value === "" ? null : Number(value);
          if (next !== saved) onSave({ [name]: next } as Partial<SavingsSettings>);
        }}
      />
    </FieldCaption>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  hint: string;
}) {
  return (
    <label className="flex items-start gap-3 cursor-pointer">
      <input
        type="checkbox"
        className="mt-1"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        <span className="block font-medium text-primary">{label}</span>
        <span className="block text-sm text-secondary">{hint}</span>
      </span>
    </label>
  );
}

// ── overview ──────────────────────────────────────────────────────────────────

function Overview({ onOpen }: { onOpen: (tab: Tab) => void }) {
  const hasAutomations = useFeature("automations");
  const { data: o } = useQuery({
    queryKey: ["savings-overview"],
    queryFn: savingsService.overview,
  });
  if (!o) return <LoadingRows rows={4} />;
  const onEnterprise = hasAutomations ? undefined : t("On the Enterprise plan");
  const groups: {
    title: string;
    items: { name: string; text: string; figure?: string; tab?: Tab; to?: string; note?: string }[];
  }[] = [
    {
      title: t("Buying"),
      items: [
        {
          name: t("Moisture and impurity deduction"),
          text: t("Pay for grain, not for water or dirt."),
          figure:
            o.deducted_php > 0
              ? t("{{amount}} kept in {{days}} days", {
                  amount: peso(o.deducted_php),
                  days: o.lookback_days,
                })
              : t("Off until you turn it on"),
          tab: "buying",
        },
        {
          name: t("Weight lock"),
          text: t("A saved weight changes only with a reason, by you or an admin."),
          tab: "buying",
        },
        {
          name: t("Highest price to pay"),
          text: t("Worked back from rice prices, recovery and imported rice."),
          tab: "buying",
        },
      ],
    },
    {
      title: t("Milling"),
      items: [
        {
          name: t("Mass balance"),
          text: t("Every kilo of palay accounted for, batch by batch."),
          figure:
            o.unaccounted_kg > 0
              ? t("{{kg}} unaccounted for", { kg: kilos(o.unaccounted_kg) })
              : undefined,
          tab: "milling",
        },
        {
          name: t("Yield alerts"),
          text: t("Low recovery and high brokens flagged on each batch."),
          figure: t("{{flagged}} of {{checked}} batches flagged", {
            flagged: o.batches_flagged,
            checked: o.batches_checked,
          }),
          tab: "milling",
        },
        {
          name: t("Lot tracing"),
          text: t("From the farmer's delivery to what came out of the mill."),
          tab: "milling",
        },
        {
          name: t("Grade blending"),
          text: t("Hit a contract's broken % without giving away whole grain."),
          tab: "milling",
        },
      ],
    },
    {
      title: t("Warehouse"),
      items: [
        {
          name: t("First in, first out"),
          text: t("Sales take the oldest rice first. Going around it needs a reason."),
          tab: "warehouse",
        },
        {
          name: t("By-product stock"),
          text: t("Darak, binlid and ipa counted like the rice they came with."),
          tab: "warehouse",
        },
        {
          name: t("Holds and readings"),
          text: t("Wet or infested stock can't be sold until it's cleared."),
          figure: o.held_kg > 0 ? t("{{kg}} on hold", { kg: kilos(o.held_kg) }) : undefined,
          tab: "warehouse",
        },
      ],
    },
    {
      title: t("Money"),
      items: [
        {
          name: t("Capacity use"),
          text: t("Tonnes milled against what the machines are rated for."),
          figure:
            o.utilization_pct != null
              ? `${percent(o.utilization_pct)} · ${BAND_TEXT(o.utilization_band)}`
              : BAND_TEXT(o.utilization_band),
          tab: "costs",
        },
        {
          name: t("Cost per sack"),
          text: t("Palay, drying, power, labor and packaging. Sale forms warn under cost."),
          tab: "costs",
        },
        {
          name: t("Vale"),
          text: t("Advances to farmers, taken off when the palay is delivered."),
          figure:
            o.vale_open_php > 0
              ? t("{{amount}} still owed", { amount: peso(o.vale_open_php) })
              : undefined,
          tab: "vale",
        },
        {
          name: t("Credit limits and collections"),
          text: t("Stop orders over a customer's limit, and see who to chase first."),
          to: "/collections",
          note: onEnterprise,
        },
        {
          name: t("Machine maintenance"),
          text: t("Service rollers and polishers before they crush head rice."),
          to: "/maintenance",
          note: onEnterprise,
        },
      ],
    },
  ];
  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <div key={group.title} className="space-y-2">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-secondary">
            {group.title}
          </h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {group.items.map((item) => {
              const body = (
                <>
                  <span className="block font-semibold text-primary">{item.name}</span>
                  <span className="mt-1 block text-sm text-secondary">{item.text}</span>
                  {item.figure && (
                    <span className="mt-2 block text-sm font-semibold text-primary">
                      {item.figure}
                    </span>
                  )}
                  {item.note && (
                    <span className="mt-2 block text-xs font-medium text-secondary">
                      {item.note}
                    </span>
                  )}
                </>
              );
              return item.to ? (
                <Link key={item.name} to={item.to} className="card block text-left hover:ring-1">
                  {body}
                </Link>
              ) : (
                <button
                  key={item.name}
                  type="button"
                  className="card block text-left hover:ring-1"
                  onClick={() => item.tab && onOpen(item.tab)}
                >
                  {body}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── buying ────────────────────────────────────────────────────────────────────

function Buying({
  settings,
  onSave,
}: {
  settings: SavingsSettings;
  onSave: (patch: Partial<SavingsSettings>) => void;
}) {
  const { data } = useQuery({ queryKey: ["savings-max-buy"], queryFn: savingsService.maxBuy });
  return (
    <div className="space-y-6">
      <Section
        title={t("How palay is paid")}
        hint={t(
          "Takes effect on new purchases. Saved purchases keep the amounts they were saved with.",
        )}
      >
        <Toggle
          checked={settings.pay_deductions}
          onChange={(next) => onSave({ pay_deductions: next })}
          label={t("Take off excess moisture and impurities")}
          hint={t(
            "Pays on the weight at 14% moisture, less impurities. Leave this off if your price per cavan already allows for wet palay, or you would deduct twice.",
          )}
        />
        <Toggle
          checked={settings.weight_lock}
          onChange={(next) => onSave({ weight_lock: next })}
          label={t("Lock saved weights")}
          hint={t(
            "Only you or an admin can change a saved weight, and the reason goes in the record's history.",
          )}
        />
      </Section>
      <Section
        title={t("Imported rice")}
        hint={t(
          "Imported rice sets a ceiling on what you can sell for. The rice tariff can change each quarter, so check the current rate before relying on this.",
        )}
      >
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <SettingField
            label={t("CIF price (US$ per ton)")}
            name="cif_usd_per_ton"
            settings={settings}
            onSave={onSave}
          />
          <SettingField
            label={t("Pesos per US$")}
            name="usd_php"
            settings={settings}
            onSave={onSave}
          />
          <SettingField
            label={t("Rice tariff %")}
            name="tariff_pct"
            settings={settings}
            onSave={onSave}
          />
          <SettingField
            label={t("Port and inland costs (₱/kg)")}
            name="landed_other_per_kg"
            settings={settings}
            onSave={onSave}
          />
        </div>
        <p className="text-sm text-secondary">
          {data?.landed_price != null
            ? t("Imported rice lands at {{price}} per kg.", { price: peso(data.landed_price) })
            : t("Type the CIF price and exchange rate to compare with imported rice.")}
        </p>
      </Section>
      <Section
        title={t("Highest price to pay for palay")}
        hint={
          data
            ? t(
                "Per kg, keeping your {{margin}}% margin at the lower of your rice price and imported rice.",
                { margin: data.target_margin_pct },
              )
            : undefined
        }
      >
        {!data ? (
          <LoadingRows />
        ) : data.rows.length === 0 ? (
          <p className="text-sm text-secondary">
            {t("Record palay purchases and rice sales to see this.")}
          </p>
        ) : (
          <Table
            head={[
              t("Variety"),
              t("Paying now"),
              t("Recovery %"),
              t("Rice sells at"),
              t("At your rice price"),
              t("At imported rice"),
              t("Pay at most"),
            ]}
          >
            {data.rows.map((r) => {
              const over =
                r.max_buy != null && r.paying_per_kg != null && r.paying_per_kg > r.max_buy;
              return (
                <tr key={r.variety_id}>
                  <Cell>{r.code}</Cell>
                  <Cell>
                    <span className={over ? "font-semibold text-rose-600 dark:text-rose-400" : ""}>
                      {pesoOr(r.paying_per_kg)}
                    </span>
                  </Cell>
                  <Cell>{percent(r.recovery_pct)}</Cell>
                  <Cell>{pesoOr(r.market_price)}</Cell>
                  <Cell>{pesoOr(r.max_at_market)}</Cell>
                  <Cell>{pesoOr(r.max_at_import)}</Cell>
                  <Cell strong>{pesoOr(r.max_buy)}</Cell>
                </tr>
              );
            })}
          </Table>
        )}
      </Section>
    </div>
  );
}

// ── milling ───────────────────────────────────────────────────────────────────

const ALERT_TEXT = (alert: BatchRow["alerts"][number]): string =>
  ({
    low_recovery: t("Low recovery"),
    high_broken: t("High brokens"),
    unaccounted: t("Kilos missing"),
  })[alert];

function TraceDetails({ id }: { id: string }) {
  const { data } = useQuery({
    queryKey: ["savings-trace", id],
    queryFn: () => savingsService.trace(id),
  });
  if (!data) return <LoadingRows rows={1} />;
  if (data.client) {
    return (
      <p className="text-sm text-secondary">
        {t("A client's palay: {{client}}", { client: data.client })}
      </p>
    );
  }
  return (
    <ul className="space-y-1 text-sm text-secondary">
      {data.lots.map((lot, n) => (
        <li key={n}>
          {lot.reference_no
            ? t("{{kg}} from {{reference}}, {{supplier}}, {{moisture}} moisture", {
                kg: kilos(lot.weight_kg),
                reference: lot.reference_no,
                supplier: lot.supplier ?? t("no supplier"),
                moisture: percent(lot.moisture_pct),
              })
            : t("{{kg}} from older stock", { kg: kilos(lot.weight_kg) })}
          {lot.dried_kg != null &&
            ` · ${t("dried {{from}} to {{to}}", {
              from: kilos(lot.bought_kg ?? 0),
              to: kilos(lot.dried_kg),
            })}`}
        </li>
      ))}
      {data.lots.length === 0 && <li>{t("Milled before lots were tracked.")}</li>}
    </ul>
  );
}

function BlendCalculator() {
  const [head, setHead] = useState("2");
  const [stream, setStream] = useState("100");
  const [target, setTarget] = useState("5");
  const [total, setTotal] = useState("1000");
  const result = blend(Number(head), Number(stream), Number(target), Number(total));
  const input = (value: string, set: (v: string) => void) => (
    <input
      className="input"
      type="number"
      min={0}
      step="any"
      value={value}
      onChange={(e) => set(e.target.value)}
    />
  );
  return (
    <Section
      title={t("Grade blending")}
      hint={t("How much of the broken bin to mix in, so you don't give away whole grain.")}
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <FieldCaption label={t("Head rice: broken %")}>{input(head, setHead)}</FieldCaption>
        <FieldCaption label={t("Broken bin: broken %")}>{input(stream, setStream)}</FieldCaption>
        <FieldCaption label={t("Contract: broken %")}>{input(target, setTarget)}</FieldCaption>
        <FieldCaption label={t("Total to make (kg)")}>{input(total, setTotal)}</FieldCaption>
      </div>
      <p className="flex items-center gap-2 text-sm font-medium text-primary">
        <BlendIcon size={16} aria-hidden />
        {result
          ? t("Mix {{head}} of head rice with {{stream}} from the broken bin ({{pct}}%).", {
              head: kilos(result.headKg),
              stream: kilos(result.streamKg),
              pct: result.streamPct.toFixed(2),
            })
          : t("These two bins can't make that grade.")}
      </p>
    </Section>
  );
}

function Milling({
  settings,
  onSave,
}: {
  settings: SavingsSettings;
  onSave: (patch: Partial<SavingsSettings>) => void;
}) {
  const { data: batches } = useQuery({
    queryKey: ["savings-batches"],
    queryFn: savingsService.batches,
  });
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="space-y-6">
      <Section
        title={t("Where each batch's palay went")}
        hint={t(
          "Recovery is all milled rice, its brokens included. Open a batch to see which purchases it came from.",
        )}
      >
        {!batches ? (
          <LoadingRows />
        ) : batches.length === 0 ? (
          <p className="text-sm text-secondary">{t("No finished batches yet.")}</p>
        ) : (
          <Table
            head={[
              t("Batch No."),
              t("Palay in"),
              t("Recovery %"),
              t("Head rice %"),
              t("Broken %"),
              t("Binlid %"),
              t("Darak %"),
              t("Ipa %"),
              t("Unaccounted"),
            ]}
          >
            {batches.flatMap((b) => {
              const row = b.balance;
              const rows = [
                <tr key={b.id}>
                  <Cell>
                    <button
                      type="button"
                      className="font-semibold text-primary underline-offset-2 hover:underline"
                      aria-expanded={open === b.id}
                      onClick={() => setOpen(open === b.id ? null : b.id)}
                    >
                      {b.batch_no}
                    </button>
                    {b.alerts.length > 0 && (
                      <span className="mt-1 flex flex-wrap gap-1">
                        {b.alerts.map((a) => (
                          <span key={a} className="badge-red">
                            {ALERT_TEXT(a)}
                          </span>
                        ))}
                      </span>
                    )}
                  </Cell>
                  <Cell>{kilos(row.input_kg)}</Cell>
                  <Cell>{percent(row.recovery_pct)}</Cell>
                  <Cell>{percent(row.head_pct)}</Cell>
                  <Cell>{percent(row.broken_pct)}</Cell>
                  <Cell>{percent(row.binlid_pct)}</Cell>
                  <Cell>{percent(row.darak_pct)}</Cell>
                  <Cell>{percent(row.ipa_pct)}</Cell>
                  <Cell>
                    {row.complete
                      ? `${kilos(row.unaccounted_kg)} (${percent(row.unaccounted_pct)})`
                      : "—"}
                  </Cell>
                </tr>,
              ];
              if (open === b.id) {
                rows.push(
                  <tr key={`${b.id}-trace`}>
                    <td colSpan={9} className="px-3 py-3">
                      <TraceDetails id={b.id} />
                    </td>
                  </tr>,
                );
              }
              return rows;
            })}
          </Table>
        )}
      </Section>
      <Section
        title={t("Alert limits")}
        hint={t("A batch past any of these is flagged here. Change them to suit your mill.")}
      >
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <SettingField
            label={t("Recovery under %")}
            name="mrr_alert_pct"
            settings={settings}
            onSave={onSave}
          />
          <SettingField
            label={t("Broken rice over %")}
            name="broken_alert_pct"
            settings={settings}
            onSave={onSave}
          />
          <SettingField
            label={t("Unaccounted over %")}
            name="unaccounted_alert_pct"
            settings={settings}
            onSave={onSave}
          />
        </div>
      </Section>
      <BlendCalculator />
    </div>
  );
}

// ── warehouse ─────────────────────────────────────────────────────────────────

const AGE_BADGE: Record<string, string> = {
  fresh: "badge-green",
  warning: "badge-yellow",
  critical: "badge-red",
  expired: "badge-red",
};

function Warehouse({
  settings,
  onSave,
}: {
  settings: SavingsSettings;
  onSave: (patch: Partial<SavingsSettings>) => void;
}) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["savings-warehouse"], queryFn: savingsService.warehouse });
  const { data: ledger } = useQuery({
    queryKey: ["savings-movements"],
    queryFn: () => savingsService.movements("byproduct"),
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["savings-warehouse"] });
    qc.invalidateQueries({ queryKey: ["savings-overview"] });
  };
  const [reason, setReason] = useState<HoldReason>("moisture");
  const [skipReason, setSkipReason] = useState("");
  const [readings, setReadings] = useState<Record<string, { humidity: string; temp: string }>>({});

  const pick = useMutation({
    mutationFn: (id: string) => savingsService.pickFirst(id, skipReason.trim() || undefined),
    onSuccess: refresh,
  });
  const hold = useMutation({
    mutationFn: (id: string) => savingsService.placeHold({ pallet_id: id, reason }),
    onSuccess: refresh,
  });
  const clear = useMutation({
    mutationFn: (id: string) => savingsService.clearHold(id),
    onSuccess: refresh,
  });
  const reading = useMutation({
    mutationFn: (zoneId: string) =>
      savingsService.addReading({
        zone_id: zoneId,
        humidity_pct: readings[zoneId]?.humidity ? Number(readings[zoneId].humidity) : undefined,
        temp_c: readings[zoneId]?.temp ? Number(readings[zoneId].temp) : undefined,
      }),
    onSuccess: refresh,
  });
  const error = apiDetail(pick.error ?? hold.error ?? clear.error ?? reading.error);
  if (!data) return <LoadingRows rows={4} />;

  return (
    <div className="space-y-6">
      {error && (
        <p role="alert" className="text-sm font-medium text-rose-600 dark:text-rose-400">
          {error}
        </p>
      )}
      <Section
        title={t("Pallets, oldest first")}
        hint={t(
          "Sales take from the top of this list by themselves. Send a pallet ahead of older ones only with a reason.",
        )}
      >
        {data.pallets.length === 0 ? (
          <p className="text-sm text-secondary">
            {t("No pallets yet. Pallets come from milling, once the branch has a floor plan.")}
          </p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <FieldCaption label={t("Reason to send a pallet ahead")}>
                <input
                  className="input"
                  value={skipReason}
                  maxLength={300}
                  onChange={(e) => setSkipReason(e.target.value)}
                />
              </FieldCaption>
              <FieldCaption label={t("Reason to hold a pallet")}>
                <Select
                  value={reason}
                  onChange={(v) => setReason(v as HoldReason)}
                  options={REASONS()}
                />
              </FieldCaption>
            </div>
            <Table
              head={[
                t("Pallet"),
                t("Variety"),
                t("Weight"),
                t("Milled"),
                t("Age"),
                t("Status"),
                "",
              ]}
            >
              {data.pallets.map((p) => (
                <tr key={p.id}>
                  <Cell strong>{p.pallet_code}</Cell>
                  <Cell>{p.variety_code ?? "—"}</Cell>
                  <Cell>{kilos(p.weight_kg)}</Cell>
                  <Cell>
                    {format(new Date(p.milling_date), "MMM d, yyyy")}
                    {p.date_assumed && (
                      <span className="ml-2 text-xs text-secondary">{t("date assumed")}</span>
                    )}
                  </Cell>
                  <Cell>
                    <span className={AGE_BADGE[p.aging_status] ?? "badge-gray"}>
                      {t("{{count}} days", { count: p.days_old })}
                    </span>
                  </Cell>
                  <Cell>
                    {p.status === "on_hold"
                      ? t("On hold")
                      : p.pick_first_reason
                        ? t("Goes next")
                        : t("In storage")}
                  </Cell>
                  <Cell>
                    {p.status === "in_storage" && (
                      <span className="flex justify-end gap-3">
                        <button
                          type="button"
                          className="text-xs font-semibold text-secondary hover:text-primary"
                          onClick={() => pick.mutate(p.id)}
                        >
                          {t("Send next")}
                        </button>
                        <button
                          type="button"
                          className="text-xs font-semibold text-rose-600 dark:text-rose-400"
                          onClick={() => hold.mutate(p.id)}
                        >
                          {t("Hold")}
                        </button>
                      </span>
                    )}
                  </Cell>
                </tr>
              ))}
            </Table>
          </>
        )}
      </Section>

      <Section
        title={t("On hold")}
        hint={t("Held stock can't be sold or picked until someone clears it.")}
      >
        {data.holds.length === 0 ? (
          <p className="text-sm text-secondary">{t("Nothing on hold.")}</p>
        ) : (
          <Table head={[t("What"), t("Weight"), t("Reason"), t("Since"), ""]}>
            {data.holds.map((h) => (
              <tr key={h.id}>
                <Cell strong>{h.pallet_code ?? h.byproduct_type ?? t("Stock")}</Cell>
                <Cell>{kilos(h.weight_kg)}</Cell>
                <Cell>{REASONS().find((r) => r.value === h.reason)?.label}</Cell>
                <Cell>{format(new Date(h.placed_at), "MMM d, yyyy")}</Cell>
                <Cell>
                  <button
                    type="button"
                    className="text-xs font-semibold text-secondary hover:text-primary"
                    onClick={() => clear.mutate(h.id)}
                  >
                    {t("Clear")}
                  </button>
                </Cell>
              </tr>
            ))}
          </Table>
        )}
      </Section>

      <Section
        title={t("Humidity and temperature")}
        hint={t("Type in what the gauge says. Readings over a zone's target are flagged.")}
      >
        {data.zones.length === 0 ? (
          <p className="text-sm text-secondary">{t("No storage zones yet.")}</p>
        ) : (
          <Table
            head={[t("Zone"), t("Last reading"), t("Target"), t("Humidity %"), t("Temp °C"), ""]}
          >
            {data.zones.map((z) => (
              <tr key={z.id}>
                <Cell strong>{z.name}</Cell>
                <Cell>
                  <span className="inline-flex items-center gap-1">
                    {z.out_of_range && (
                      <AlertTriangle
                        size={14}
                        className="text-rose-600"
                        aria-label={t("Over target")}
                      />
                    )}
                    {z.read_at ? `${percent(z.humidity_pct)} · ${z.temp_c ?? "—"} °C` : "—"}
                  </span>
                </Cell>
                <Cell>
                  {z.target_humidity_pct != null || z.target_temp_c != null
                    ? `${percent(z.target_humidity_pct)} · ${z.target_temp_c ?? "—"} °C`
                    : "—"}
                </Cell>
                <Cell>
                  <input
                    className="input w-24"
                    type="number"
                    aria-label={t("Humidity %")}
                    value={readings[z.id]?.humidity ?? ""}
                    onChange={(e) =>
                      setReadings((r) => ({
                        ...r,
                        [z.id]: { temp: r[z.id]?.temp ?? "", humidity: e.target.value },
                      }))
                    }
                  />
                </Cell>
                <Cell>
                  <input
                    className="input w-24"
                    type="number"
                    aria-label={t("Temp °C")}
                    value={readings[z.id]?.temp ?? ""}
                    onChange={(e) =>
                      setReadings((r) => ({
                        ...r,
                        [z.id]: { humidity: r[z.id]?.humidity ?? "", temp: e.target.value },
                      }))
                    }
                  />
                </Cell>
                <Cell>
                  <button
                    type="button"
                    className="text-xs font-semibold text-secondary hover:text-primary"
                    disabled={!readings[z.id]?.humidity && !readings[z.id]?.temp}
                    onClick={() => reading.mutate(z.id)}
                  >
                    {t("Save reading")}
                  </button>
                </Cell>
              </tr>
            ))}
          </Table>
        )}
      </Section>

      <Section
        title={t("By-products")}
        hint={t(
          "On hand, what sold, and how long the oldest has sat. Sell darak while it's fresh.",
        )}
      >
        <div className="max-w-xs">
          <SettingField
            label={t("Darak stays fresh for (days)")}
            name="bran_fresh_days"
            settings={settings}
            onSave={onSave}
          />
        </div>
        {data.byproducts.length === 0 ? (
          <p className="text-sm text-secondary">{t("No by-products in stock yet.")}</p>
        ) : (
          <Table head={[t("By-product"), t("On hand"), t("Sold, 30 days"), t("Oldest")]}>
            {data.byproducts.map((b) => (
              <tr key={b.byproduct_type}>
                <Cell strong>{b.byproduct_type}</Cell>
                <Cell>{kilos(b.on_hand_kg)}</Cell>
                <Cell>{kilos(b.sold_30d_kg)}</Cell>
                <Cell>
                  {b.oldest_days == null ? (
                    t("Before tracking")
                  ) : (
                    <span className={b.stale ? "badge-red" : "badge-gray"}>
                      {t("{{count}} days", { count: b.oldest_days })}
                    </span>
                  )}
                </Cell>
              </tr>
            ))}
          </Table>
        )}
        {ledger && ledger.length > 0 && (
          <details>
            <summary className="cursor-pointer text-sm font-medium text-secondary">
              {t("Stock ledger")}
            </summary>
            <div className="mt-3">
              <Table head={[t("When"), t("By-product"), t("Change"), t("Balance"), t("Note")]}>
                {ledger.map((m) => (
                  <tr key={m.id}>
                    <Cell>{format(new Date(m.created_at), "MMM d, HH:mm")}</Cell>
                    <Cell>{m.byproduct_type ?? "—"}</Cell>
                    <Cell>{kilos(m.delta_kg)}</Cell>
                    <Cell>{kilos(m.balance_after_kg)}</Cell>
                    <Cell>{m.notes ?? "—"}</Cell>
                  </tr>
                ))}
              </Table>
            </div>
          </details>
        )}
      </Section>
    </div>
  );
}

// ── costs and capacity ────────────────────────────────────────────────────────

function Costs({
  settings,
  onSave,
}: {
  settings: SavingsSettings;
  onSave: (patch: Partial<SavingsSettings>) => void;
}) {
  const { data: capacity } = useQuery({
    queryKey: ["savings-capacity"],
    queryFn: savingsService.capacity,
  });
  const { data: cost } = useQuery({
    queryKey: ["savings-cost"],
    queryFn: savingsService.costPerSack,
  });
  return (
    <div className="space-y-6">
      <Section
        title={t("Capacity use")}
        hint={
          capacity
            ? t("Break-even line {{line}}%, target {{low}}–{{high}}%.", {
                line: capacity.settings.break_even,
                low: capacity.settings.optimal_low,
                high: capacity.settings.optimal_high,
              })
            : undefined
        }
      >
        {!capacity ? (
          <LoadingRows />
        ) : capacity.machines === 0 ? (
          <p className="text-sm text-secondary">
            {t("Add each machine's capacity and rated hours in the")}{" "}
            <Link to="/catalog" className="font-medium underline">
              {t("Catalog")}
            </Link>
            {"."}
          </p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                { label: t("Today"), row: capacity.today },
                { label: t("This week"), row: capacity.week },
              ].map(({ label, row }) => (
                <div
                  key={label}
                  className="rounded-xl border border-gray-200 p-4 dark:border-slate-700"
                >
                  <p className="text-sm text-secondary">{label}</p>
                  <p className="text-2xl font-bold text-primary">{percent(row.pct)}</p>
                  <p className="text-sm text-secondary">
                    {kilos(row.milled_kg)} / {kilos(row.rated_kg ?? 0)}
                  </p>
                  <span className={BAND_BADGE[row.band]}>{BAND_TEXT(row.band)}</span>
                </div>
              ))}
            </div>
            <Table head={[t("Week of"), t("Milled"), t("Use"), t("Status")]}>
              {capacity.weeks.map((w) => (
                <tr key={w.week_of}>
                  <Cell>{format(new Date(w.week_of), "MMM d, yyyy")}</Cell>
                  <Cell>{kilos(w.milled_kg)}</Cell>
                  <Cell>{percent(w.pct)}</Cell>
                  <Cell>
                    <span className={BAND_BADGE[w.band]}>{BAND_TEXT(w.band)}</span>
                  </Cell>
                </tr>
              ))}
            </Table>
          </>
        )}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <SettingField
            label={t("Break-even line %")}
            name="break_even_utilization_pct"
            settings={settings}
            onSave={onSave}
          />
          <SettingField
            label={t("Target from %")}
            name="optimal_low_pct"
            settings={settings}
            onSave={onSave}
          />
          <SettingField
            label={t("Target to %")}
            name="optimal_high_pct"
            settings={settings}
            onSave={onSave}
          />
          <SettingField
            label={t("Working days a week")}
            name="working_days_per_week"
            settings={settings}
            onSave={onSave}
          />
        </div>
      </Section>
      <Section
        title={t("Cost per sack")}
        hint={t(
          "From the last 90 days. Fuel, power and labor count when an expense is linked to a batch; drying counts when its cost is recorded.",
        )}
      >
        <div className="grid grid-cols-2 gap-3 max-w-md">
          <SettingField
            label={t("Packaging per sack (₱)")}
            name="packaging_per_sack"
            settings={settings}
            onSave={onSave}
          />
          <SettingField
            label={t("Kg per sack")}
            name="kg_per_sack"
            settings={settings}
            onSave={onSave}
          />
        </div>
        {!cost ? (
          <LoadingRows />
        ) : cost.rows.length === 0 ? (
          <p className="text-sm text-secondary">{t("Record palay purchases to see this.")}</p>
        ) : (
          <Table
            head={[
              t("Variety"),
              t("Palay"),
              t("Other costs"),
              t("Packaging"),
              t("By-products back"),
              t("Cost per sack"),
              t("Sells for"),
            ]}
          >
            {cost.rows.map((r) => (
              <tr key={r.variety_id}>
                <Cell>{r.code}</Cell>
                <Cell>{peso(r.palay)}</Cell>
                <Cell>{peso(r.other)}</Cell>
                <Cell>{peso(r.packaging)}</Cell>
                <Cell>{peso(r.byproducts)}</Cell>
                <Cell strong>{peso(r.total)}</Cell>
                <Cell>
                  <span className={r.below_cost ? "badge-red" : ""}>{pesoOr(r.market)}</span>
                </Cell>
              </tr>
            ))}
          </Table>
        )}
      </Section>
    </div>
  );
}

// ── vale ──────────────────────────────────────────────────────────────────────

function Vale() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["savings-advances"], queryFn: savingsService.advances });
  const { data: suppliers = [] } = useQuery<any[]>({
    queryKey: ["suppliers"],
    queryFn: () => paddyService.listSuppliers(),
  });
  const [form, setForm] = useState({
    supplier_id: "",
    advance_date: format(new Date(), "yyyy-MM-dd"),
    kind: "cash" as "cash" | "inputs",
    amount: "",
    note: "",
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["savings-advances"] });
    qc.invalidateQueries({ queryKey: ["savings-overview"] });
  };
  const create = useMutation({
    mutationFn: () =>
      savingsService.createAdvance({
        ...form,
        amount: Number(form.amount),
        note: form.note || undefined,
      }),
    onSuccess: () => {
      refresh();
      setForm((f) => ({ ...f, amount: "", note: "" }));
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => savingsService.voidAdvance(id),
    onSuccess: refresh,
  });
  const error = apiDetail(create.error ?? remove.error);
  return (
    <div className="space-y-6">
      <Section
        title={t("Give a vale")}
        hint={t(
          "Cash or farm inputs ahead of the harvest. It's taken off automatically when the farmer's next palay purchase is saved.",
        )}
      >
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <FieldCaption label={t("Farmer")}>
            <Select
              value={form.supplier_id}
              onChange={(v) => setForm((f) => ({ ...f, supplier_id: v }))}
              options={suppliers
                .filter((s) => s.is_active !== false)
                .map((s) => ({ value: s.id, label: s.name }))}
              placeholder={t("Choose")}
            />
          </FieldCaption>
          <FieldCaption label={t("Date")}>
            <input
              className="input"
              type="date"
              value={form.advance_date}
              onChange={(e) => setForm((f) => ({ ...f, advance_date: e.target.value }))}
            />
          </FieldCaption>
          <FieldCaption label={t("Given as")}>
            <Select
              value={form.kind}
              onChange={(v) => setForm((f) => ({ ...f, kind: v as "cash" | "inputs" }))}
              options={[
                { value: "cash", label: t("Cash") },
                { value: "inputs", label: t("Farm inputs") },
              ]}
            />
          </FieldCaption>
          <FieldCaption label={t("Amount (₱)")}>
            <input
              className="input"
              type="number"
              min={0}
              value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
            />
          </FieldCaption>
        </div>
        <FieldCaption label={t("Note")}>
          <input
            className="input"
            maxLength={500}
            placeholder={t("Optional")}
            value={form.note}
            onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
          />
        </FieldCaption>
        {error && (
          <p role="alert" className="text-sm font-medium text-rose-600 dark:text-rose-400">
            {error}
          </p>
        )}
        <button
          type="button"
          className="btn-primary"
          disabled={!form.supplier_id || !(Number(form.amount) > 0) || create.isPending}
          onClick={() => create.mutate()}
        >
          {t("Save vale")}
        </button>
      </Section>
      <Section
        title={t("Vale given")}
        hint={data ? t("{{amount}} still owed.", { amount: peso(data.open_php) }) : undefined}
      >
        {!data ? (
          <LoadingRows />
        ) : data.rows.length === 0 ? (
          <p className="text-sm text-secondary">{t("No vale recorded yet.")}</p>
        ) : (
          <Table
            head={[
              t("Date"),
              t("Farmer"),
              t("Given as"),
              t("Amount"),
              t("Taken off"),
              t("Owed"),
              "",
            ]}
          >
            {data.rows.map((a) => (
              <tr key={a.id}>
                <Cell>{format(new Date(a.advance_date), "MMM d, yyyy")}</Cell>
                <Cell strong>{a.supplier ?? "—"}</Cell>
                <Cell>{a.kind === "cash" ? t("Cash") : t("Farm inputs")}</Cell>
                <Cell>{peso(a.amount)}</Cell>
                <Cell>{peso(a.settled)}</Cell>
                <Cell strong>{peso(a.open)}</Cell>
                <Cell>
                  {a.settled === 0 && (
                    <button
                      type="button"
                      className="text-xs font-semibold text-rose-600 dark:text-rose-400"
                      onClick={() => remove.mutate(a.id)}
                    >
                      {t("Void")}
                    </button>
                  )}
                </Cell>
              </tr>
            ))}
          </Table>
        )}
      </Section>
    </div>
  );
}

// ── the page ──────────────────────────────────────────────────────────────────

export default function SavingsPage() {
  const { role } = useAccess();
  const boss = role === "owner";
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("overview");
  const { data: settings } = useQuery({
    queryKey: ["savings-settings"],
    queryFn: savingsService.settings,
    enabled: boss,
  });
  const save = useMutation({
    mutationFn: (patch: Partial<SavingsSettings>) => savingsService.saveSettings(patch),
    onSuccess: (next) => {
      qc.setQueryData(["savings-settings"], next);
      for (const key of [
        "savings-max-buy",
        "savings-batches",
        "savings-capacity",
        "savings-cost",
      ]) {
        qc.invalidateQueries({ queryKey: [key] });
      }
    },
  });
  const onSave = (patch: Partial<SavingsSettings>) => save.mutate(patch);

  if (!boss) {
    return (
      <EmptyState icon={ShieldAlert} title={t("Only the Boss sees this page")}>
        {t("It shows the mill's real costs and margins.")}
      </EmptyState>
    );
  }
  return (
    <div className="space-y-6">
      <div>
        <h2 className="flex items-center gap-2 text-xl font-bold text-gray-900 dark:text-slate-100">
          <PiggyBankIcon size={22} /> {t("Savings")}
        </h2>
        <p className="text-sm text-gray-500 dark:text-slate-400">
          {t("Where your mill loses money, and what's stopping it")}
        </p>
      </div>
      <div
        role="tablist"
        className="tab-strip flex items-center gap-1 p-1 rounded-xl glass overflow-x-auto"
      >
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold whitespace-nowrap transition-all ${
              tab === key
                ? "bg-grad-brand text-white shadow-grad-glow"
                : "text-secondary hover:text-primary hover:bg-slate-100/60 dark:hover:bg-slate-700/30"
            }`}
          >
            <Icon size={15} aria-hidden /> {label()}
          </button>
        ))}
      </div>
      {save.isError && (
        <p role="alert" className="text-sm font-medium text-rose-600 dark:text-rose-400">
          {apiDetail(save.error)}
        </p>
      )}
      {!settings ? (
        <LoadingRows rows={4} />
      ) : (
        <>
          {tab === "overview" && <Overview onOpen={setTab} />}
          {tab === "buying" && <Buying settings={settings} onSave={onSave} />}
          {tab === "milling" && <Milling settings={settings} onSave={onSave} />}
          {tab === "warehouse" && <Warehouse settings={settings} onSave={onSave} />}
          {tab === "costs" && <Costs settings={settings} onSave={onSave} />}
          {tab === "vale" && <Vale />}
        </>
      )}
    </div>
  );
}
