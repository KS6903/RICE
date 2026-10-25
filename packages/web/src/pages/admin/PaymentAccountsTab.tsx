import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Check, ImagePlus, Landmark, Loader2, QrCode, Trash2 } from "lucide-react";
import type { SubscriptionPlan } from "@rice-mill/shared";
import { adminService } from "../../services/AdminService";
import { mediaUrl } from "../../utils/media";

const LABEL = "form-label";
const ERROR_BOX =
  "flex items-start gap-2 px-3 py-2.5 rounded-lg bg-rose-50 dark:bg-rose-900/30 ring-1 ring-rose-200 dark:ring-rose-800 text-sm text-rose-700 dark:text-rose-300";

const detail = (error: unknown, fallback: string) => {
  const d = (error as any)?.response?.data?.detail;
  return typeof d === "string" ? d : fallback;
};

/**
 * Settings > Payment accounts: where mills send the money for each paid plan,
 * shown on their checkout page. The QR picture is kept in Cloudflare R2.
 */
export default function PaymentAccountsTab() {
  const { data: plans = [], isLoading } = useQuery<SubscriptionPlan[]>({
    queryKey: ["admin-plans"],
    queryFn: () => adminService.getPlans(),
  });
  const paid = plans.filter((p) => p.monthly_price > 0).sort((a, b) => a.sort_order - b.sort_order);

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-lg font-bold text-primary">Payment accounts</h3>
        <p className="text-sm text-muted mt-0.5">
          Where mills send the money for each plan. They see it, with the QR code, on their checkout
          page.
        </p>
      </div>
      {isLoading ? (
        <div className="card flex items-center gap-2 text-sm text-secondary">
          <Loader2 size={15} className="animate-spin" /> Loading the plans…
        </div>
      ) : paid.length === 0 ? (
        <div className="card text-sm text-secondary">
          No paid plans yet. Give a plan a price in Plans first.
        </div>
      ) : (
        paid.map((p) => <AccountCard key={p.id} plan={p} />)
      )}
    </div>
  );
}

function AccountCard({ plan }: { plan: SubscriptionPlan }) {
  const qc = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({
    payment_bank: plan.payment_bank ?? "",
    payment_account_name: plan.payment_account_name ?? "",
    payment_account_number: plan.payment_account_number ?? "",
  });
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setForm({
      payment_bank: plan.payment_bank ?? "",
      payment_account_name: plan.payment_account_name ?? "",
      payment_account_number: plan.payment_account_number ?? "",
    });
  }, [plan.payment_bank, plan.payment_account_name, plan.payment_account_number]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["admin-plans"] });
    qc.invalidateQueries({ queryKey: ["billing-plans"] });
  };

  const save = useMutation({
    mutationFn: () => adminService.updatePaymentAccount(plan.id, form),
    onSuccess: () => {
      refresh();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
  });
  const upload = useMutation({
    mutationFn: (file: File) => adminService.uploadPaymentQr(plan.id, file),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: () => adminService.removePaymentQr(plan.id),
    onSuccess: refresh,
  });

  const changed =
    form.payment_bank !== (plan.payment_bank ?? "") ||
    form.payment_account_name !== (plan.payment_account_name ?? "") ||
    form.payment_account_number !== (plan.payment_account_number ?? "");
  const id = (field: string) => `pay-${plan.id}-${field}`;

  return (
    <section className="card space-y-4" aria-label={`${plan.name} payment account`}>
      <div className="flex items-center gap-2">
        <Landmark size={18} className="text-emerald-600 dark:text-emerald-400" />
        <h4 className="font-bold text-primary">{plan.name}</h4>
      </div>

      <div className="flex flex-col md:flex-row gap-5">
        <div className="flex-1 space-y-4">
          <div>
            <label htmlFor={id("bank")} className={LABEL}>
              Bank or e-wallet
            </label>
            <input
              id={id("bank")}
              className="input"
              maxLength={100}
              value={form.payment_bank}
              onChange={(e) => setForm((f) => ({ ...f, payment_bank: e.target.value }))}
              placeholder="e.g. BDO"
            />
          </div>
          <div>
            <label htmlFor={id("name")} className={LABEL}>
              Account name
            </label>
            <input
              id={id("name")}
              className="input"
              maxLength={150}
              value={form.payment_account_name}
              onChange={(e) => setForm((f) => ({ ...f, payment_account_name: e.target.value }))}
            />
          </div>
          <div>
            <label htmlFor={id("number")} className={LABEL}>
              Account number
            </label>
            <input
              id={id("number")}
              className="input font-mono"
              maxLength={50}
              value={form.payment_account_number}
              onChange={(e) => setForm((f) => ({ ...f, payment_account_number: e.target.value }))}
              placeholder="e.g. 0019 9057 4325"
            />
            <p className="text-xs text-muted mt-1">
              Shown as typed. Mills copy it without the spaces.
            </p>
          </div>
          {save.isError && (
            <div className={ERROR_BOX}>
              <AlertCircle size={15} className="mt-0.5 shrink-0" />
              {detail(save.error, "Failed to save the account.")}
            </div>
          )}
          <div className="flex items-center gap-3">
            <button
              onClick={() => save.mutate()}
              disabled={save.isPending || !changed}
              className="btn-primary"
            >
              {save.isPending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Check size={14} />
              )}
              Save account
            </button>
            {saved && (
              <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1">
                <Check size={14} /> Saved
              </span>
            )}
          </div>
        </div>

        <div className="md:w-56 shrink-0 space-y-2">
          <p className={LABEL}>QR code</p>
          <div className="aspect-square w-full max-w-[14rem] rounded-xl border border-dashed border-slate-300 dark:border-slate-600 bg-white grid place-items-center overflow-hidden">
            {plan.payment_qr_key ? (
              <img
                src={mediaUrl(plan.payment_qr_key)}
                alt={`${plan.name} payment QR code`}
                className="w-full h-full object-contain"
              />
            ) : (
              <div className="text-center text-slate-400 px-4">
                <QrCode size={36} className="mx-auto" />
                <p className="text-xs mt-1.5">No QR code yet</p>
              </div>
            )}
          </div>
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            aria-label={`Upload ${plan.name} QR code`}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) upload.mutate(file);
              e.target.value = "";
            }}
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              disabled={upload.isPending}
              className="btn-secondary flex-1 !px-3 !text-sm"
            >
              {upload.isPending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <ImagePlus size={14} />
              )}
              {plan.payment_qr_key ? "Replace" : "Upload"}
            </button>
            {plan.payment_qr_key && (
              <button
                type="button"
                onClick={() => remove.mutate()}
                disabled={remove.isPending}
                className="btn-secondary !px-3 !text-sm"
                aria-label={`Remove ${plan.name} QR code`}
                title="Remove"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
          <p className="text-xs text-muted">PNG, JPEG or WebP, up to 3 MB.</p>
          {(upload.isError || remove.isError) && (
            <div className={ERROR_BOX}>
              <AlertCircle size={15} className="mt-0.5 shrink-0" />
              {detail(upload.error ?? remove.error, "The QR code couldn't be saved.")}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
