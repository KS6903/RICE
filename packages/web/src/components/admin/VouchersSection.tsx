import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Lock, Plus, Ticket, Trash2, X as XIcon } from "lucide-react";
import { format } from "date-fns";
import { adminService, type AdminVoucher, type VoucherKind } from "../../services/AdminService";
import Select from "../Select";
import DatePicker from "../DatePicker";
import { t } from "../../i18n";

const peso = (n: number) => `₱${n.toLocaleString()}`;

/** What a voucher gives, in a few words: "20% off", "₱500 off", "1 month of Pro free". */
export function voucherValue(v: {
  kind: VoucherKind;
  percent_off: number | null;
  amount_off: number | null;
  amount_off_usd: number | null;
  free_months: number;
  free_days: number;
  plan_name: string | null;
}): string {
  if (v.kind === "percent_off") return t("{{pct}}% off", { pct: v.percent_off });
  if (v.kind === "amount_off") {
    const parts = [
      v.amount_off ? peso(v.amount_off) : null,
      v.amount_off_usd ? `$${v.amount_off_usd}` : null,
    ].filter(Boolean);
    return t("{{amount}} off", { amount: parts.join(" / ") });
  }
  const time = [
    v.free_months ? t("{{count}} months", { count: v.free_months }) : null,
    v.free_days ? t("{{count}} days", { count: v.free_days }) : null,
  ]
    .filter(Boolean)
    .join(" ");
  return t("{{time}} of {{plan}} free", { time, plan: v.plan_name ?? t("a plan") });
}

type Draft = {
  code: string;
  kind: VoucherKind;
  plan_id: string;
  billing_interval: string;
  percent_off: string;
  amount_off: string;
  amount_off_usd: string;
  free_months: string;
  free_days: string;
  company_id: string;
  max_uses: string;
  expires_on: string;
  note: string;
};

const EMPTY: Draft = {
  code: "",
  kind: "percent_off",
  plan_id: "",
  billing_interval: "",
  percent_off: "",
  amount_off: "",
  amount_off_usd: "",
  free_months: "1",
  free_days: "0",
  company_id: "",
  max_uses: "",
  expires_on: "",
  note: "",
};

function errorText(e: any): string {
  const detail = e?.response?.data?.detail;
  return typeof detail === "string" ? detail : t("Couldn't save that change.");
}

/**
 * BossAdmin's vouchers (backend services/vouchers.py), on the Plans tab. Each
 * one gives what you choose: free time on a plan, a percent off, or an amount
 * off. Lock it to one account and it works there only, once, and can't be passed
 * on. Without an account it works for as many mills as you allow, once each.
 */
export default function VouchersSection() {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const { data: vouchers = [], isLoading } = useQuery({
    queryKey: ["admin-vouchers"],
    queryFn: () => adminService.listVouchers(),
  });
  const { data: plans = [] } = useQuery<any[]>({
    queryKey: ["admin-plans"],
    queryFn: () => adminService.getPlans(),
  });
  const { data: mills = [] } = useQuery({
    queryKey: ["admin-tenant-names"],
    queryFn: () => adminService.tenantNames(),
    enabled: draft !== null,
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["admin-vouchers"] });
  const create = useMutation({
    mutationFn: (d: Draft) =>
      adminService.createVoucher({
        code: d.code.trim() || null,
        kind: d.kind,
        plan_id: d.plan_id || null,
        billing_interval: d.billing_interval || null,
        percent_off: d.kind === "percent_off" ? Number(d.percent_off) : null,
        amount_off: d.kind === "amount_off" && d.amount_off ? Number(d.amount_off) : null,
        amount_off_usd:
          d.kind === "amount_off" && d.amount_off_usd ? Number(d.amount_off_usd) : null,
        free_months: d.kind === "free_time" ? Number(d.free_months || 0) : 0,
        free_days: d.kind === "free_time" ? Number(d.free_days || 0) : 0,
        company_id: d.company_id || null,
        max_uses: d.company_id || !d.max_uses ? null : Number(d.max_uses),
        // The end of that day, where BossAdmin is.
        expires_at: d.expires_on ? new Date(`${d.expires_on}T23:59:59`).toISOString() : null,
        note: d.note.trim() || null,
      }),
    onSuccess: () => {
      setDraft(null);
      setError(null);
      refresh();
    },
    onError: (e) => setError(errorText(e)),
  });
  const toggle = useMutation({
    mutationFn: (v: AdminVoucher) => adminService.updateVoucher(v.id, { is_active: !v.is_active }),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (id: string) => adminService.deleteVoucher(id),
    onSuccess: refresh,
    onError: (e) => setError(errorText(e)),
  });

  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(code);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopied(null);
    }
  };

  const paidPlans = plans.filter((p) => p.code !== "free");
  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));

  return (
    <div className="panel">
      <div className="px-6 py-4 border-b border-soft flex items-center gap-2 flex-wrap">
        <Ticket size={16} className="text-muted" />
        <div>
          <h3 className="font-semibold text-primary">{t("Vouchers")}</h3>
          <p className="text-xs text-muted">
            {t("Codes you give to mills: free time on a plan, a percent off, or an amount off.")}
          </p>
        </div>
        {!draft && (
          <button
            type="button"
            className="btn-primary py-2! text-sm! ml-auto"
            onClick={() => {
              setError(null);
              setDraft({ ...EMPTY });
            }}
          >
            <Plus size={14} /> {t("New voucher")}
          </button>
        )}
      </div>

      {error && !draft && (
        <p className="px-6 pt-3 text-sm text-rose-600 dark:text-rose-400">{error}</p>
      )}

      {draft && (
        <form
          className="px-6 py-5 border-b border-soft grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate(draft);
          }}
        >
          <div className="sm:col-span-2">
            <label className="form-label">{t("What it gives")}</label>
            <Select
              value={draft.kind}
              onChange={(v) => set({ kind: v as VoucherKind })}
              options={[
                { value: "percent_off", label: t("A percent off a payment") },
                { value: "amount_off", label: t("An amount off a payment") },
                { value: "free_time", label: t("Free time on a plan") },
              ]}
              aria-label={t("What it gives")}
            />
          </div>

          {draft.kind === "percent_off" && (
            <div>
              <label className="form-label" htmlFor="v-pct">
                {t("Percent off")}
              </label>
              <input
                id="v-pct"
                className="input"
                inputMode="decimal"
                value={draft.percent_off}
                onChange={(e) => set({ percent_off: e.target.value.replace(/[^\d.]/g, "") })}
                placeholder="20"
                required
              />
            </div>
          )}
          {draft.kind === "amount_off" && (
            <>
              <div>
                <label className="form-label" htmlFor="v-php">
                  {t("Pesos off")}
                </label>
                <input
                  id="v-php"
                  className="input"
                  inputMode="decimal"
                  value={draft.amount_off}
                  onChange={(e) => set({ amount_off: e.target.value.replace(/[^\d.]/g, "") })}
                  placeholder="500"
                />
              </div>
              <div>
                <label className="form-label" htmlFor="v-usd">
                  {t("US dollars off (PayPal), optional")}
                </label>
                <input
                  id="v-usd"
                  className="input"
                  inputMode="decimal"
                  value={draft.amount_off_usd}
                  onChange={(e) => set({ amount_off_usd: e.target.value.replace(/[^\d.]/g, "") })}
                  placeholder="10"
                />
              </div>
            </>
          )}
          {draft.kind === "free_time" && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="form-label" htmlFor="v-months">
                  {t("Months")}
                </label>
                <input
                  id="v-months"
                  className="input"
                  inputMode="numeric"
                  value={draft.free_months}
                  onChange={(e) => set({ free_months: e.target.value.replace(/\D/g, "") })}
                />
              </div>
              <div>
                <label className="form-label" htmlFor="v-days">
                  {t("Days")}
                </label>
                <input
                  id="v-days"
                  className="input"
                  inputMode="numeric"
                  value={draft.free_days}
                  onChange={(e) => set({ free_days: e.target.value.replace(/\D/g, "") })}
                />
              </div>
            </div>
          )}

          <div>
            <label className="form-label">{t("Plan")}</label>
            <Select
              value={draft.plan_id}
              onChange={(v) => set({ plan_id: v })}
              options={[
                ...(draft.kind === "free_time" ? [] : [{ value: "", label: t("Any paid plan") }]),
                ...paidPlans.map((p) => ({ value: p.id, label: p.name })),
              ]}
              placeholder={t("Pick a plan")}
              aria-label={t("Plan")}
            />
          </div>
          {draft.kind !== "free_time" && (
            <div>
              <label className="form-label">{t("Payments")}</label>
              <Select
                value={draft.billing_interval}
                onChange={(v) => set({ billing_interval: v })}
                options={[
                  { value: "", label: t("Monthly or yearly") },
                  { value: "monthly", label: t("Monthly only") },
                  { value: "annual", label: t("Yearly only") },
                ]}
                aria-label={t("Payments")}
              />
            </div>
          )}

          <div>
            <label className="form-label">{t("Account")}</label>
            <Select
              value={draft.company_id}
              onChange={(v) => set({ company_id: v })}
              options={[
                { value: "", label: t("Any account") },
                ...mills.map((m) => ({ value: m.id, label: m.name })),
              ]}
              aria-label={t("Account")}
            />
            <p className="text-xs text-muted mt-1">
              {draft.company_id
                ? t("Only this account can use it, once. It can't be passed on.")
                : t("Any account can use it, once each.")}
            </p>
          </div>
          {!draft.company_id && (
            <div>
              <label className="form-label" htmlFor="v-max">
                {t("How many accounts in all (blank for no limit)")}
              </label>
              <input
                id="v-max"
                className="input"
                inputMode="numeric"
                value={draft.max_uses}
                onChange={(e) => set({ max_uses: e.target.value.replace(/\D/g, "") })}
              />
            </div>
          )}

          <div>
            <label className="form-label">{t("Last day it works (optional)")}</label>
            <DatePicker
              value={draft.expires_on}
              onChange={(v) => set({ expires_on: v })}
              clearable
              aria-label={t("Last day it works (optional)")}
            />
          </div>
          <div>
            <label className="form-label" htmlFor="v-code">
              {t("Code (blank to make one up)")}
            </label>
            <input
              id="v-code"
              className="input font-mono uppercase"
              value={draft.code}
              maxLength={40}
              onChange={(e) => set({ code: e.target.value.toUpperCase() })}
              placeholder="ABCD-EFGH-JKMN"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="form-label" htmlFor="v-note">
              {t("Note for yourself (optional)")}
            </label>
            <input
              id="v-note"
              className="input"
              value={draft.note}
              maxLength={300}
              onChange={(e) => set({ note: e.target.value })}
            />
          </div>

          {error && (
            <p className="sm:col-span-2 text-sm font-medium text-rose-600 dark:text-rose-400">
              {error}
            </p>
          )}
          <div className="sm:col-span-2 flex gap-2">
            <button type="submit" className="btn-primary" disabled={create.isPending}>
              <Check size={14} /> {t("Create voucher")}
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setDraft(null);
                setError(null);
              }}
            >
              <XIcon size={14} /> {t("Cancel")}
            </button>
          </div>
        </form>
      )}

      <div className="overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>{t("Code")}</th>
              <th>{t("Gives")}</th>
              <th>{t("For")}</th>
              <th>{t("Used")}</th>
              <th>{t("Ends")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={6}>
                  <div className="skeleton h-4 w-1/2" />
                </td>
              </tr>
            )}
            {vouchers.map((v) => (
              <tr key={v.id} className={v.is_active ? "" : "opacity-60"}>
                <td>
                  <button
                    type="button"
                    onClick={() => void copy(v.code)}
                    className="inline-flex items-center gap-1.5 font-mono text-sm font-semibold text-primary"
                    title={t("Copy")}
                  >
                    {v.code}
                    {copied === v.code ? (
                      <Check size={12} className="text-emerald-600" />
                    ) : (
                      <Copy size={12} className="text-muted" />
                    )}
                  </button>
                  {v.note && <div className="text-xs text-muted">{v.note}</div>}
                </td>
                <td className="text-sm">
                  {voucherValue(v)}
                  {v.kind !== "free_time" && (
                    <div className="text-xs text-muted">
                      {[
                        v.plan_name ?? t("Any paid plan"),
                        v.billing_interval === "monthly"
                          ? t("Monthly only")
                          : v.billing_interval === "annual"
                            ? t("Yearly only")
                            : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  )}
                </td>
                <td className="text-sm">
                  {v.company_name ? (
                    <span className="inline-flex items-center gap-1">
                      <Lock size={12} className="text-muted" /> {v.company_name}
                    </span>
                  ) : (
                    t("Any account")
                  )}
                </td>
                <td className="text-sm tabular-nums">
                  {v.max_uses ? `${v.uses} / ${v.max_uses}` : v.uses}
                </td>
                <td className="text-xs text-secondary whitespace-nowrap">
                  {v.expires_at ? format(new Date(v.expires_at), "MMM d, yyyy") : t("No end")}
                </td>
                <td className="text-right whitespace-nowrap">
                  <button
                    type="button"
                    className="btn-ghost px-2! py-1.5! text-xs"
                    onClick={() => toggle.mutate(v)}
                    disabled={toggle.isPending}
                  >
                    {v.is_active ? t("Turn off") : t("Turn on")}
                  </button>
                  {v.uses === 0 && (
                    <button
                      type="button"
                      className="btn-ghost px-2! py-1.5! text-xs text-rose-600"
                      onClick={() => remove.mutate(v.id)}
                      disabled={remove.isPending}
                      aria-label={t("Delete voucher {{code}}", { code: v.code })}
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!isLoading && vouchers.length === 0 && (
              <tr>
                <td colSpan={6} className="py-8! text-center text-sm text-muted">
                  {t("No vouchers yet.")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
