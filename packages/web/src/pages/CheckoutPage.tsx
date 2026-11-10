import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  CreditCard,
  Download,
  Globe,
  Landmark,
  Loader2,
  Lock,
  ShieldCheck,
  Ticket,
  Wallet,
  XCircle,
} from "lucide-react";
import type {
  BillingInterval,
  PaymentProvider,
  SubscriptionPlan,
  UpgradeRequest,
} from "@rice-mill/shared";
import { billingService } from "../services/BillingService";
import { useCurrentPlan } from "../hooks/useFeature";
import { useAuthStore } from "../stores/authStore";
import ComboInput from "../components/ComboInput";
import { PH_BANKS, PH_EWALLETS } from "../utils/phPaymentProviders";
import ConfirmItsYou, { type Proof } from "../components/ConfirmItsYou";
import { voucherService, type VoucherCheck } from "../services/BillingService";
import { mediaUrl } from "../utils/media";
import { redirectTo } from "../utils/redirect";
import { t } from "../i18n";
import { tx } from "../i18n/tx";

const LABEL = "block text-sm font-semibold text-secondary mb-1.5";

// The server refuses a bigger screenshot too (services/payment_notices.py).
const RECEIPT_MAX_BYTES = 5 * 1024 * 1024;
// Where a transfer comes from: the e-wallets most mills use first, then every
// bank and e-wallet the BSP lists. Anything else can still be typed.
const PAID_FROM_SUGGESTIONS = Array.from(new Set(["GCash", "Maya", ...PH_EWALLETS, ...PH_BANKS]));

const peso = (n: number) => `₱${n.toLocaleString()}`;
const dollars = (n: number) =>
  `$${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

/** The price in US dollars, for PayPal. 0 when the plan isn't offered in dollars. */
function usdPriceFor(p: SubscriptionPlan, interval: BillingInterval) {
  const monthly = p.monthly_price_usd ?? 0;
  if (interval === "monthly") return monthly;
  return (p.annual_price_usd ?? 0) > 0 ? (p.annual_price_usd as number) : monthly * 12;
}

/** A plan with no annual price set is billed as 12 months. */
function priceFor(p: SubscriptionPlan, interval: BillingInterval) {
  if (interval === "monthly") return { price: p.monthly_price, savingsPct: 0 };
  const hasAnnual = p.annual_price > 0;
  const price = hasAnnual ? p.annual_price : p.monthly_price * 12;
  const savingsPct =
    hasAnnual && p.monthly_price > 0
      ? Math.round((1 - p.annual_price / (p.monthly_price * 12)) * 100)
      : 0;
  return { price, savingsPct };
}

/** Copies the text (an account number, without its spaces) and says so. */
function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };
  return (
    <button
      type="button"
      onClick={copy}
      aria-label={label}
      className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ring-slate-200 dark:ring-slate-700 text-secondary hover:text-primary hover:bg-slate-100 dark:hover:bg-slate-700/40 transition-colors"
    >
      {copied ? (
        <>
          <Check size={12} className="text-emerald-600" /> {t("Copied")}
        </>
      ) : (
        <>
          <Copy size={12} /> {t("Copy")}
        </>
      )}
    </button>
  );
}

/**
 * Pays for a plan picked on Settings > Billing. The mill sends the money to the
 * plan's bank account (set by BossAdmin on the plan), types the reference from
 * its receipt, and that goes to BossAdmin as the upgrade request's note to check
 * and approve.
 */
export default function CheckoutPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const planId = params.get("plan") ?? "";
  const [interval, setBillingInterval] = useState<BillingInterval>(
    params.get("interval") === "annual" ? "annual" : "monthly",
  );
  const current = useCurrentPlan();
  const user = useAuthStore((s) => s.user);
  // Only the Boss changes the plan, and confirms it's them each time (the
  // server checks both: services/billing_service.py confirm_boss).
  const canRequest = user?.role === "owner";
  const usesCode = !!user?.mfa_enabled;
  const [reference, setReference] = useState("");
  // A bank transfer: the bank or e-wallet it came from, and a screenshot of it.
  const [paidFrom, setPaidFrom] = useState("");
  const [receipt, setReceipt] = useState<File | null>(null);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const [voucherCode, setVoucherCode] = useState("");
  const [voucher, setVoucher] = useState<VoucherCheck | null>(null);
  const [voucherError, setVoucherError] = useState<string | null>(null);
  // What is waiting for "confirm it's you": the bank-transfer request, or a
  // payment online, and why the last try was refused.
  const [asking, setAsking] = useState<{
    action: "submit" | PaymentProvider;
    error?: string;
  } | null>(null);
  const cancelled = params.get("cancelled") === "1";

  const plansQuery = useQuery<SubscriptionPlan[]>({
    queryKey: ["billing-plans"],
    queryFn: () => billingService.getPlans(),
  });
  const { data: requestData } = useQuery<{ request: UpgradeRequest | null }>({
    queryKey: ["billing-my-request"],
    queryFn: () => billingService.getMyRequest(),
  });
  const { data: online = { paymongo: false, paypal: false } } = useQuery({
    queryKey: ["billing-payment-options"],
    queryFn: () => billingService.getPaymentOptions(),
  });

  const plan = plansQuery.data?.find((p) => p.id === planId);
  // No account on the plan yet: the request goes without a reference and
  // BossAdmin sorts out payment with the mill.
  const paymentReady = !!plan?.payment_account_number;
  const isOnPaidPlan =
    !!current &&
    current.monthly_price > 0 &&
    (current.status === "active" || current.status === "trial");
  const pending = requestData?.request?.status === "pending" ? requestData.request : null;

  const proofFields = (proof: Proof) => ({
    current_password: proof.password,
    mfa_code: proof.code || undefined,
    voucher_code: voucher?.voucher.code ?? undefined,
  });
  // A refused confirmation (a wrong password, a code that ran out) asks again.
  const askAgain = (e: any, action: "submit" | PaymentProvider) => {
    if (e?.response?.data?.code !== "confirm_failed") return;
    const detail = e?.response?.data?.detail;
    setAsking({ action, error: typeof detail === "string" ? detail : t("That didn't work.") });
  };

  const applyVoucher = useMutation({
    mutationFn: () =>
      voucherService.check({ code: voucherCode, plan_id: planId, billing_interval: interval }),
    onSuccess: (result) => {
      setVoucherError(null);
      if (result.voucher.kind === "free_time") {
        setVoucher(null);
        setVoucherError(t("This voucher gives free time on a plan. Redeem it in Billing instead."));
        return;
      }
      setVoucher(result);
    },
    onError: (e: any) => {
      setVoucher(null);
      const detail = e?.response?.data?.detail;
      setVoucherError(typeof detail === "string" ? detail : t("That voucher code isn't valid."));
    },
  });
  // A voucher is checked for one interval: picking the other one asks again.
  const pickInterval = (iv: BillingInterval) => {
    setBillingInterval(iv);
    setVoucher(null);
    setVoucherError(null);
  };

  const submit = useMutation({
    mutationFn: (proof: Proof) => {
      const ref = reference.trim();
      // The plan has an account to pay into: the transfer goes with its
      // screenshot, and the server writes the note from these fields.
      if (paymentReady && receipt) {
        const form = new FormData();
        form.append("plan_id", planId);
        form.append("billing_interval", interval);
        form.append("request_type", isOnPaidPlan ? "change" : "upgrade");
        form.append("reference", ref);
        form.append("paid_from", paidFrom.trim());
        form.append("current_password", proof.password);
        if (proof.code) form.append("mfa_code", proof.code);
        if (voucher) form.append("voucher_code", voucher.voucher.code);
        form.append("receipt", receipt);
        return billingService.createUpgradeRequestWithReceipt(form);
      }
      const note =
        paymentReady && plan
          ? `Paid to ${plan.payment_bank || "the bank account"}, reference ${ref}`
          : ref
            ? `Payment reference ${ref}`
            : undefined;
      return billingService.createUpgradeRequest({
        plan_id: planId,
        request_type: isOnPaidPlan ? "change" : "upgrade",
        billing_interval: interval,
        note,
        ...proofFields(proof),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["billing-my-request"] });
    },
    onError: (e) => askAgain(e, "submit"),
  });

  // Paying online: the provider's page takes over, and sends the mill back to
  // /settings/checkout/return, which confirms the payment (CheckoutReturnPage).
  const payOnline = useMutation({
    mutationFn: ({ provider, proof }: { provider: PaymentProvider; proof: Proof }) =>
      billingService.startCheckout({
        plan_id: planId,
        billing_interval: interval,
        provider,
        ...proofFields(proof),
      }),
    onSuccess: ({ checkout_url }) => redirectTo(checkout_url),
    onError: (e, { provider }) => askAgain(e, provider),
  });

  const errorMessage =
    typeof (submit.error as any)?.response?.data?.detail === "string"
      ? (submit.error as any).response.data.detail
      : submit.isError
        ? t("The request could not be sent. Try again.")
        : null;
  const onlineError =
    typeof (payOnline.error as any)?.response?.data?.detail === "string"
      ? (payOnline.error as any).response.data.detail
      : payOnline.isError
        ? t("The payment page could not be opened. Try again.")
        : null;

  const header = (
    <div className="flex items-center gap-3">
      <div className="h-11 w-11 rounded-xl bg-grad-brand grid place-items-center shadow-grad-glow">
        <CreditCard size={20} className="text-white" />
      </div>
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-primary">{t("Checkout")}</h2>
        <p className="text-sm text-secondary">{t("Pay for your plan")}</p>
      </div>
    </div>
  );

  const backLink = (
    <Link
      to="/settings"
      className="inline-flex items-center gap-1.5 text-sm font-semibold text-secondary hover:text-primary"
    >
      <ArrowLeft size={15} /> {t("Back to Billing")}
    </Link>
  );

  const notice = (title: string, body: React.ReactNode) => (
    <div className="space-y-6">
      {backLink}
      {header}
      <div className="card max-w-xl">
        <h3 className="text-lg font-bold text-primary">{title}</h3>
        <div className="text-sm text-secondary mt-1.5">{body}</div>
        <Link to="/settings" className="btn-secondary mt-4 inline-flex">
          {t("Back to Billing")}
        </Link>
      </div>
    </div>
  );

  if (plansQuery.isLoading) {
    return (
      <div className="space-y-6">
        {backLink}
        {header}
        <div className="card flex items-center gap-2 text-sm text-secondary">
          <Loader2 size={15} className="animate-spin" /> {t("Loading the plan…")}
        </div>
      </div>
    );
  }

  if (submit.isSuccess) {
    return (
      <div className="space-y-6">
        {header}
        <div className="card max-w-xl text-center py-8">
          <CheckCircle2 size={40} className="mx-auto text-emerald-500" />
          <h3 className="text-xl font-bold text-primary mt-3">{t("Request sent")}</h3>
          <p className="text-sm text-secondary mt-1.5">
            {paymentReady
              ? t(
                  "We'll check your payment and turn on {{plan}} once it's confirmed. You'll get an email when it's done.",
                  { plan: plan?.name },
                )
              : t(
                  "We'll contact you about payment for {{plan}}. You'll get an email when the plan is turned on.",
                  { plan: plan?.name },
                )}
          </p>
          <button onClick={() => navigate("/settings")} className="btn-primary mt-5">
            {t("Back to Billing")}
          </button>
        </div>
      </div>
    );
  }

  if (!canRequest) {
    return notice(
      t("Only the Boss can change the plan"),
      t("Ask the mill's owner to pick a plan in Settings."),
    );
  }
  if (!plan || plan.code === "free") {
    return notice(t("That plan isn't available"), t("Pick a plan again from the list in Billing."));
  }
  if (current?.code === plan.code) {
    return notice(
      t("You're already on {{name}}", { name: plan.name }),
      t("There's nothing to pay for this plan."),
    );
  }
  if (pending) {
    return notice(
      t("You already have a request waiting"),
      <>
        {tx(
          "Your request for {{plan}} is still waiting for approval. Cancel it in Billing first to pick another plan.",
          { plan: <span className="font-semibold">{pending.requested_plan_name}</span> },
        )}
      </>,
    );
  }

  const { price, savingsPct } = priceFor(plan, interval);
  const listUsdPrice = usdPriceFor(plan, interval);
  // With a voucher, the totals are the server's (vouchers/check); the server
  // works them out again when the payment starts, whatever is shown here.
  const phpTotal = voucher?.prices?.PHP?.total ?? price;
  const phpOff = voucher?.prices?.PHP?.discount ?? 0;
  const usdPrice = voucher ? (voucher.prices?.USD?.total ?? 0) : listUsdPrice;
  const offerPaypal = online.paypal && usdPrice > 0;
  const anyOnline = online.paymongo || offerPaypal;
  const needsReference = paymentReady;
  const canSubmit =
    !submit.isPending &&
    (!needsReference || (reference.trim() !== "" && paidFrom.trim() !== "" && !!receipt));
  const leaving = payOnline.isPending || payOnline.isSuccess;

  return (
    <div className="space-y-6">
      {backLink}
      {header}

      {cancelled && (
        <div className="flex gap-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 ring-1 ring-slate-200 dark:ring-slate-700 px-4 py-3 text-sm text-secondary">
          <XCircle size={16} className="shrink-0 mt-0.5" />
          {t("The payment was cancelled and nothing was charged. You can try again below.")}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-start">
        <div className="lg:col-span-3 space-y-6">
          {anyOnline && (
            <section className="card space-y-4" aria-label={t("Pay online")}>
              <div>
                <h3 className="text-lg font-bold text-primary">{t("Pay online")}</h3>
                <p className="text-sm text-secondary mt-0.5">
                  {t("Your plan turns on as soon as the payment goes through.")}
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {online.paymongo && (
                  <button
                    type="button"
                    onClick={() => setAsking({ action: "paymongo" })}
                    disabled={leaving}
                    className="btn-primary h-auto! py-3! flex-col items-start! text-left"
                  >
                    <span className="flex items-center gap-2 text-base">
                      {payOnline.isPending && payOnline.variables?.provider === "paymongo" ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : (
                        <Wallet size={16} />
                      )}
                      {t("Pay {{price}}", { price: peso(phpTotal) })}
                    </span>
                    <span className="text-xs font-medium opacity-90">
                      {t("GCash, Maya, QR Ph, card or online banking")}
                    </span>
                  </button>
                )}
                {offerPaypal && (
                  <button
                    type="button"
                    onClick={() => setAsking({ action: "paypal" })}
                    disabled={leaving}
                    className="btn-secondary h-auto! py-3! flex-col items-start! text-left"
                  >
                    <span className="flex items-center gap-2 text-base">
                      {payOnline.isPending && payOnline.variables?.provider === "paypal" ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : (
                        <Globe size={16} />
                      )}
                      {t("Pay")} {dollars(usdPrice)} {t("USD")}
                    </span>
                    <span className="text-xs font-medium text-secondary">
                      {t("From abroad: PayPal or card, in US dollars")}
                    </span>
                  </button>
                )}
              </div>
              {onlineError && (
                <p className="text-sm font-medium text-rose-600 dark:text-rose-400">
                  {onlineError}
                </p>
              )}
              <p className="flex items-start gap-1.5 text-xs text-muted">
                <Lock size={14} className="shrink-0 mt-px" />
                {t("You'll pay on")}{" "}
                {online.paymongo && offerPaypal
                  ? t("PayMongo's or PayPal's")
                  : online.paymongo
                    ? t("PayMongo's")
                    : t("PayPal's")}{" "}
                {t("secure page, then come back here. Card details never reach us.")}
              </p>
            </section>
          )}

          <section className="card space-y-5" aria-label={t("Payment")}>
            <div>
              <h3 className="text-lg font-bold text-primary">
                {anyOnline ? t("Or pay by bank transfer") : t("Pay by bank transfer")}
              </h3>
              <p className="text-sm text-secondary mt-0.5">
                {paymentReady
                  ? t(
                      "Send {{price}} to this account, then enter the reference from your receipt.",
                      { price: peso(phpTotal) },
                    )
                  : t("Total to pay: {{price}}.", { price: peso(phpTotal) })}
              </p>
            </div>

            {paymentReady ? (
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4">
                <div className="flex flex-col sm:flex-row gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-3 text-emerald-600 dark:text-emerald-400">
                      <Landmark size={18} />
                      <span className="font-bold text-primary">{plan.payment_bank}</span>
                    </div>
                    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm items-center">
                      {plan.payment_account_name && (
                        <>
                          <dt className="text-secondary">{t("Account name")}</dt>
                          <dd className="font-semibold text-primary">
                            {plan.payment_account_name}
                          </dd>
                        </>
                      )}
                      <dt className="text-secondary">{t("Account number")}</dt>
                      <dd className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-primary font-mono">
                          {plan.payment_account_number}
                        </span>
                        <CopyButton
                          text={(plan.payment_account_number ?? "").replace(/\s+/g, "")}
                          label={t("Copy account number")}
                        />
                      </dd>
                      <dt className="text-secondary">{t("Amount")}</dt>
                      <dd className="font-semibold text-primary">{peso(phpTotal)}</dd>
                    </dl>
                  </div>
                  {plan.payment_qr_key && (
                    <div className="sm:w-44 shrink-0 text-center">
                      <img
                        src={mediaUrl(plan.payment_qr_key)}
                        alt={t("QR code to pay {{bank}}", { bank: plan.payment_bank ?? "" })}
                        className="w-44 h-44 mx-auto rounded-lg border border-slate-200 dark:border-slate-700 object-contain bg-white"
                      />
                      <a
                        href={mediaUrl(plan.payment_qr_key)}
                        download={`oraiza-${plan.code}-qr`}
                        className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline"
                      >
                        <Download size={13} /> {t("Save QR code")}
                      </a>
                      <p className="text-[11px] text-muted mt-0.5">
                        {t("Scan it, or save it and open it in your bank or e-wallet app.")}
                      </p>
                    </div>
                  )}
                </div>
                <p className="text-xs text-muted mt-3">
                  {t(
                    "Pay from any bank or e-wallet (GCash, Maya and others) through InstaPay or PESONet, or deposit over the counter.",
                  )}
                </p>
              </div>
            ) : (
              <div className="flex gap-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 ring-1 ring-amber-200 dark:ring-amber-800 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
                <Clock size={16} className="shrink-0 mt-0.5" />
                <span>
                  {t(
                    "Payment details for {{name}} are coming soon. You can send your request now and we'll contact you about how to pay.",
                    { name: plan.name },
                  )}
                </span>
              </div>
            )}

            <div>
              <label htmlFor="payment-reference" className={LABEL}>
                {t("Payment reference")}
                {!needsReference && t(" (optional)")}
              </label>
              <input
                id="payment-reference"
                className="input font-mono"
                value={reference}
                maxLength={100}
                autoComplete="off"
                onChange={(e) => setReference(e.target.value)}
                placeholder="e.g. 1234567890123"
              />
              <p className="text-xs text-muted mt-1">
                {t("The reference or confirmation number on your transfer receipt")}
              </p>
            </div>

            {paymentReady && (
              <>
                <div>
                  <label htmlFor="paid-from" className={LABEL}>
                    {t("Paid from")}
                  </label>
                  <ComboInput
                    id="paid-from"
                    value={paidFrom}
                    onChange={setPaidFrom}
                    suggestions={PAID_FROM_SUGGESTIONS}
                    maxLength={100}
                    placeholder={t("GCash, Maya, BDO, BPI…")}
                    aria-label={t("Paid from")}
                  />
                  <p className="text-xs text-muted mt-1">
                    {t("The bank or e-wallet you sent the money from")}
                  </p>
                </div>

                <div>
                  <label htmlFor="payment-receipt" className={LABEL}>
                    {t("Screenshot of your payment")}
                  </label>
                  <input
                    id="payment-receipt"
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="input py-2!"
                    onChange={(e) => {
                      const file = e.target.files?.[0] ?? null;
                      setReceiptError(null);
                      if (file && file.size > RECEIPT_MAX_BYTES) {
                        setReceipt(null);
                        setReceiptError(t("The screenshot is over 5 MB. Use a smaller one."));
                        return;
                      }
                      setReceipt(file);
                    }}
                  />
                  <p className="text-xs text-muted mt-1">
                    {receiptError ? (
                      <span className="text-rose-600 dark:text-rose-400">{receiptError}</span>
                    ) : (
                      t(
                        "A screenshot or photo of the confirmation, showing the amount and reference",
                      )
                    )}
                  </p>
                </div>
              </>
            )}

            {errorMessage && (
              <p className="text-sm font-medium text-rose-600 dark:text-rose-400">{errorMessage}</p>
            )}

            <button
              onClick={() => setAsking({ action: "submit" })}
              disabled={!canSubmit}
              className={
                anyOnline
                  ? "btn-secondary w-full disabled:opacity-60 disabled:cursor-not-allowed"
                  : "btn-primary w-full"
              }
            >
              {submit.isPending ? (
                <>
                  <Loader2 size={14} className="animate-spin" /> {t("Sending…")}
                </>
              ) : paymentReady ? (
                t("I've paid, send for confirmation")
              ) : (
                t("Send request")
              )}
            </button>
            <p className="flex items-start gap-1.5 text-xs text-muted">
              <ShieldCheck size={14} className="shrink-0 mt-px" />
              {t(
                "We check bank transfers by hand. Your plan changes once the payment is confirmed, and you'll get an email either way.",
              )}
            </p>
          </section>
        </div>

        <aside className="card lg:col-span-2 space-y-4" aria-label={t("Order summary")}>
          <h3 className="text-lg font-bold text-primary">{t("Order summary")}</h3>

          <div className="seg w-full" role="group" aria-label={t("Billing interval")}>
            {(["monthly", "annual"] as const).map((iv) => (
              <button
                key={iv}
                type="button"
                onClick={() => pickInterval(iv)}
                aria-pressed={interval === iv}
                className={`seg-btn flex-1 ${interval === iv ? "is-active" : ""}`}
              >
                {iv === "monthly" ? t("Monthly") : t("Annual")}
              </button>
            ))}
          </div>

          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-bold text-primary">{t("{{name}} plan", { name: plan.name })}</p>
              <p className="text-xs text-secondary mt-0.5">
                {plan.max_users
                  ? t("{{count}} users", { count: plan.max_users })
                  : t("Unlimited users")}{" "}
                ·{" "}
                {plan.max_branches
                  ? t("{{count}} branches", { count: plan.max_branches })
                  : t("Unlimited branches")}
              </p>
            </div>
            <p className="font-semibold text-primary whitespace-nowrap">{peso(price)}</p>
          </div>

          {plan.features?.length > 0 && (
            <ul className="text-sm text-secondary space-y-1">
              <li className="flex items-center gap-1.5">
                <Check size={14} className="text-emerald-500 shrink-0" />
                {t("{{featuresCount}} features included", { featuresCount: plan.features.length })}
              </li>
              {current && (
                <li className="flex items-center gap-1.5">
                  <Check size={14} className="text-emerald-500 shrink-0" />
                  {t("Replaces {{name}}", { name: current.name })}
                </li>
              )}
            </ul>
          )}

          <form
            className="space-y-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              if (voucherCode.trim()) applyVoucher.mutate();
            }}
          >
            <label htmlFor="voucher-code" className={LABEL}>
              {t("Voucher code")}
            </label>
            <div className="flex gap-2">
              <input
                id="voucher-code"
                className="input font-mono uppercase flex-1"
                value={voucherCode}
                maxLength={60}
                autoComplete="off"
                onChange={(e) => {
                  setVoucherCode(e.target.value.toUpperCase());
                  setVoucher(null);
                  setVoucherError(null);
                }}
                placeholder="ABCD-EFGH-JKMN"
              />
              <button
                type="submit"
                className="btn-secondary"
                disabled={!voucherCode.trim() || applyVoucher.isPending}
              >
                {applyVoucher.isPending ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Ticket size={14} />
                )}{" "}
                {t("Apply")}
              </button>
            </div>
            {voucherError && (
              <p className="text-xs font-medium text-rose-600 dark:text-rose-400">{voucherError}</p>
            )}
          </form>

          {voucher && phpOff > 0 && (
            <div className="flex items-center justify-between text-sm text-emerald-700 dark:text-emerald-400">
              <span className="inline-flex items-center gap-1.5">
                <Ticket size={14} /> {t("Voucher {{code}}", { code: voucher.voucher.code })}
              </span>
              <span className="font-semibold">−{peso(phpOff)}</span>
            </div>
          )}

          <div className="border-t border-slate-200 dark:border-slate-700 pt-3 flex items-baseline justify-between">
            <span className="text-sm font-semibold text-secondary">{t("Total due")}</span>
            <span className="text-2xl font-extrabold text-primary">
              {peso(phpTotal)}
              <span className="text-sm font-semibold text-secondary">
                {interval === "annual" ? "/yr" : "/mo"}
              </span>
            </span>
          </div>
          {savingsPct > 0 && (
            <p className="text-xs font-bold text-emerald-600 dark:text-emerald-400 -mt-2 text-right">
              {t("Save {{savingsPct}}% vs monthly", { savingsPct })}
            </p>
          )}
          {offerPaypal && (
            <p className="text-xs text-secondary -mt-2 text-right">
              {t("or")} {dollars(usdPrice)} {t("USD through PayPal")}
            </p>
          )}
          {isOnPaidPlan && (
            <p className="text-xs text-secondary">
              {anyOnline
                ? t(
                    "Paid online, the new plan starts right away. By bank transfer, it starts when your current billing period ends.",
                  )
                : t("The new plan takes effect at the end of your current billing period.")}
            </p>
          )}
        </aside>
      </div>

      <ConfirmItsYou
        key={asking?.error ?? "first"}
        open={!!asking}
        usesCode={usesCode}
        reason={t("Changing the plan needs you to confirm it's you.")}
        error={asking?.error}
        onConfirm={(proof) => {
          const action = asking?.action;
          setAsking(null);
          if (action === "submit") submit.mutate(proof);
          else if (action) payOnline.mutate({ provider: action, proof });
        }}
        onCancel={() => setAsking(null)}
      />
    </div>
  );
}
