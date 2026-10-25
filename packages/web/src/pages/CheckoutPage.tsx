import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Clock,
  CreditCard,
  Globe,
  Landmark,
  Loader2,
  Lock,
  ShieldCheck,
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
import { useAccess } from "../hooks/useAccess";
import { redirectTo } from "../utils/redirect";

const LABEL = "block text-sm font-semibold text-secondary mb-1.5";

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
  const canRequest = useAccess().canEdit("settings");
  const [reference, setReference] = useState("");
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

  const submit = useMutation({
    mutationFn: () => {
      const ref = reference.trim();
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
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["billing-my-request"] });
    },
  });

  // Paying online: the provider's page takes over, and sends the mill back to
  // /settings/checkout/return, which confirms the payment (CheckoutReturnPage).
  const payOnline = useMutation({
    mutationFn: (provider: PaymentProvider) =>
      billingService.startCheckout({ plan_id: planId, billing_interval: interval, provider }),
    onSuccess: ({ checkout_url }) => redirectTo(checkout_url),
  });

  const errorMessage =
    typeof (submit.error as any)?.response?.data?.detail === "string"
      ? (submit.error as any).response.data.detail
      : submit.isError
        ? "The request could not be sent. Try again."
        : null;
  const onlineError =
    typeof (payOnline.error as any)?.response?.data?.detail === "string"
      ? (payOnline.error as any).response.data.detail
      : payOnline.isError
        ? "The payment page could not be opened. Try again."
        : null;

  const header = (
    <div className="flex items-center gap-3">
      <div className="h-11 w-11 rounded-xl bg-grad-brand grid place-items-center shadow-grad-glow">
        <CreditCard size={20} className="text-white" />
      </div>
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-primary">Checkout</h2>
        <p className="text-sm text-secondary">Pay for your plan</p>
      </div>
    </div>
  );

  const backLink = (
    <Link
      to="/settings"
      className="inline-flex items-center gap-1.5 text-sm font-semibold text-secondary hover:text-primary"
    >
      <ArrowLeft size={15} /> Back to Billing
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
          Back to Billing
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
          <Loader2 size={15} className="animate-spin" /> Loading the plan…
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
          <h3 className="text-xl font-bold text-primary mt-3">Request sent</h3>
          <p className="text-sm text-secondary mt-1.5">
            {paymentReady
              ? `We'll check your payment and turn on ${plan?.name} once it's confirmed. You'll get an email when it's done.`
              : `We'll contact you about payment for ${plan?.name}. You'll get an email when the plan is turned on.`}
          </p>
          <button onClick={() => navigate("/settings")} className="btn-primary mt-5">
            Back to Billing
          </button>
        </div>
      </div>
    );
  }

  if (!canRequest) {
    return notice(
      "Only the Boss or an admin can change the plan",
      "Ask the mill's owner to pick a plan in Settings.",
    );
  }
  if (!plan || plan.code === "free") {
    return notice("That plan isn't available", "Pick a plan again from the list in Billing.");
  }
  if (current?.code === plan.code) {
    return notice(`You're already on ${plan.name}`, "There's nothing to pay for this plan.");
  }
  if (pending) {
    return notice(
      "You already have a request waiting",
      <>
        Your request for <span className="font-semibold">{pending.requested_plan_name}</span> is
        still waiting for approval. Cancel it in Billing first to pick another plan.
      </>,
    );
  }

  const { price, savingsPct } = priceFor(plan, interval);
  const usdPrice = usdPriceFor(plan, interval);
  const offerPaypal = online.paypal && usdPrice > 0;
  const anyOnline = online.paymongo || offerPaypal;
  const needsReference = paymentReady;
  const canSubmit = !submit.isPending && (!needsReference || reference.trim() !== "");
  const leaving = payOnline.isPending || payOnline.isSuccess;

  return (
    <div className="space-y-6">
      {backLink}
      {header}

      {cancelled && (
        <div className="flex gap-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 ring-1 ring-slate-200 dark:ring-slate-700 px-4 py-3 text-sm text-secondary">
          <XCircle size={16} className="shrink-0 mt-0.5" />
          The payment was cancelled and nothing was charged. You can try again below.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-start">
        <div className="lg:col-span-3 space-y-6">
          {anyOnline && (
            <section className="card space-y-4" aria-label="Pay online">
              <div>
                <h3 className="text-lg font-bold text-primary">Pay online</h3>
                <p className="text-sm text-secondary mt-0.5">
                  Your plan turns on as soon as the payment goes through.
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {online.paymongo && (
                  <button
                    type="button"
                    onClick={() => payOnline.mutate("paymongo")}
                    disabled={leaving}
                    className="btn-primary !h-auto !py-3 flex-col !items-start text-left"
                  >
                    <span className="flex items-center gap-2 text-base">
                      {payOnline.isPending && payOnline.variables === "paymongo" ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : (
                        <Wallet size={16} />
                      )}
                      Pay {peso(price)}
                    </span>
                    <span className="text-xs font-medium opacity-90">
                      GCash, Maya, QR Ph, card or online banking
                    </span>
                  </button>
                )}
                {offerPaypal && (
                  <button
                    type="button"
                    onClick={() => payOnline.mutate("paypal")}
                    disabled={leaving}
                    className="btn-secondary !h-auto !py-3 flex-col !items-start text-left"
                  >
                    <span className="flex items-center gap-2 text-base">
                      {payOnline.isPending && payOnline.variables === "paypal" ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : (
                        <Globe size={16} />
                      )}
                      Pay {dollars(usdPrice)} USD
                    </span>
                    <span className="text-xs font-medium text-secondary">
                      From abroad: PayPal or card, in US dollars
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
                You'll pay on{" "}
                {online.paymongo && offerPaypal
                  ? "PayMongo's or PayPal's"
                  : online.paymongo
                    ? "PayMongo's"
                    : "PayPal's"}{" "}
                secure page, then come back here. Card details never reach us.
              </p>
            </section>
          )}

          <section className="card space-y-5" aria-label="Payment">
            <div>
              <h3 className="text-lg font-bold text-primary">
                {anyOnline ? "Or pay by bank transfer" : "Pay by bank transfer"}
              </h3>
              <p className="text-sm text-secondary mt-0.5">
                {paymentReady
                  ? `Send ${peso(price)} to this account, then enter the reference from your receipt.`
                  : `Total to pay: ${peso(price)}.`}
              </p>
            </div>

            {paymentReady ? (
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4">
                <div className="flex items-center gap-2 mb-3 text-emerald-600 dark:text-emerald-400">
                  <Landmark size={18} />
                  <span className="font-bold text-primary">{plan.payment_bank}</span>
                </div>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                  {plan.payment_account_name && (
                    <>
                      <dt className="text-secondary">Account name</dt>
                      <dd className="font-semibold text-primary">{plan.payment_account_name}</dd>
                    </>
                  )}
                  <dt className="text-secondary">Account number</dt>
                  <dd className="font-semibold text-primary font-mono">
                    {plan.payment_account_number}
                  </dd>
                  <dt className="text-secondary">Amount</dt>
                  <dd className="font-semibold text-primary">{peso(price)}</dd>
                </dl>
                <p className="text-xs text-muted mt-3">
                  Pay from any bank or e-wallet (GCash, Maya and others) through InstaPay or
                  PESONet, or deposit over the counter.
                </p>
              </div>
            ) : (
              <div className="flex gap-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 ring-1 ring-amber-200 dark:ring-amber-800 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
                <Clock size={16} className="shrink-0 mt-0.5" />
                <span>
                  Payment details for {plan.name} are coming soon. You can send your request now and
                  we'll contact you about how to pay.
                </span>
              </div>
            )}

            <div>
              <label htmlFor="payment-reference" className={LABEL}>
                Payment reference{!needsReference && " (optional)"}
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
                The reference or confirmation number on your transfer receipt
              </p>
            </div>

            {errorMessage && (
              <p className="text-sm font-medium text-rose-600 dark:text-rose-400">{errorMessage}</p>
            )}

            <button
              onClick={() => submit.mutate()}
              disabled={!canSubmit}
              className={
                anyOnline
                  ? "btn-secondary w-full disabled:opacity-60 disabled:cursor-not-allowed"
                  : "btn-primary w-full"
              }
            >
              {submit.isPending ? (
                <>
                  <Loader2 size={14} className="animate-spin" /> Sending…
                </>
              ) : paymentReady ? (
                "I've paid, send for confirmation"
              ) : (
                "Send request"
              )}
            </button>
            <p className="flex items-start gap-1.5 text-xs text-muted">
              <ShieldCheck size={14} className="shrink-0 mt-px" />
              We check bank transfers by hand. Your plan changes once the payment is confirmed, and
              you'll get an email either way.
            </p>
          </section>
        </div>

        <aside className="card lg:col-span-2 space-y-4" aria-label="Order summary">
          <h3 className="text-lg font-bold text-primary">Order summary</h3>

          <div className="seg w-full" role="group" aria-label="Billing interval">
            {(["monthly", "annual"] as const).map((iv) => (
              <button
                key={iv}
                type="button"
                onClick={() => setBillingInterval(iv)}
                aria-pressed={interval === iv}
                className={`seg-btn flex-1 ${interval === iv ? "is-active" : ""}`}
              >
                {iv === "monthly" ? "Monthly" : "Annual"}
              </button>
            ))}
          </div>

          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-bold text-primary">{plan.name} plan</p>
              <p className="text-xs text-secondary mt-0.5">
                {plan.max_users ? `${plan.max_users} users` : "Unlimited users"} ·{" "}
                {plan.max_branches
                  ? `${plan.max_branches} ${plan.max_branches === 1 ? "warehouse" : "warehouses"}`
                  : "Unlimited warehouses"}
              </p>
            </div>
            <p className="font-semibold text-primary whitespace-nowrap">{peso(price)}</p>
          </div>

          {plan.features?.length > 0 && (
            <ul className="text-sm text-secondary space-y-1">
              <li className="flex items-center gap-1.5">
                <Check size={14} className="text-emerald-500 shrink-0" />
                {plan.features.length} features included
              </li>
              {current && (
                <li className="flex items-center gap-1.5">
                  <Check size={14} className="text-emerald-500 shrink-0" />
                  Replaces {current.name}
                </li>
              )}
            </ul>
          )}

          <div className="border-t border-slate-200 dark:border-slate-700 pt-3 flex items-baseline justify-between">
            <span className="text-sm font-semibold text-secondary">Total due</span>
            <span className="text-2xl font-extrabold text-primary">
              {peso(price)}
              <span className="text-sm font-semibold text-secondary">
                {interval === "annual" ? "/yr" : "/mo"}
              </span>
            </span>
          </div>
          {savingsPct > 0 && (
            <p className="text-xs font-bold text-emerald-600 dark:text-emerald-400 -mt-2 text-right">
              Save {savingsPct}% vs monthly
            </p>
          )}
          {offerPaypal && (
            <p className="text-xs text-secondary -mt-2 text-right">
              or {dollars(usdPrice)} USD through PayPal
            </p>
          )}
          {isOnPaidPlan && (
            <p className="text-xs text-secondary">
              {anyOnline
                ? "Paid online, the new plan starts right away. By bank transfer, it starts when your current billing period ends."
                : "The new plan takes effect at the end of your current billing period."}
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}
