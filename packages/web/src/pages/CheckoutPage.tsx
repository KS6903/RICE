import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Clock,
  CreditCard,
  Landmark,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import type { BillingInterval, SubscriptionPlan, UpgradeRequest } from "@rice-mill/shared";
import { billingService } from "../services/BillingService";
import { useCurrentPlan } from "../hooks/useFeature";
import { useAccess } from "../hooks/useAccess";

const LABEL = "block text-sm font-semibold text-secondary mb-1.5";

const peso = (n: number) => `₱${n.toLocaleString()}`;

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

  const plansQuery = useQuery<SubscriptionPlan[]>({
    queryKey: ["billing-plans"],
    queryFn: () => billingService.getPlans(),
  });
  const { data: requestData } = useQuery<{ request: UpgradeRequest | null }>({
    queryKey: ["billing-my-request"],
    queryFn: () => billingService.getMyRequest(),
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

  const errorMessage =
    typeof (submit.error as any)?.response?.data?.detail === "string"
      ? (submit.error as any).response.data.detail
      : submit.isError
        ? "The request could not be sent. Try again."
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
  const needsReference = paymentReady;
  const canSubmit = !submit.isPending && (!needsReference || reference.trim() !== "");

  return (
    <div className="space-y-6">
      {backLink}
      {header}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-start">
        <section className="card lg:col-span-3 space-y-5" aria-label="Payment">
          <div>
            <h3 className="text-lg font-bold text-primary">Pay by bank transfer</h3>
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
            className="btn-primary w-full"
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
            Your plan changes once the payment is confirmed. You'll get an email either way.
          </p>
        </section>

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
          {isOnPaidPlan && (
            <p className="text-xs text-secondary">
              The new plan takes effect at the end of your current billing period.
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}
