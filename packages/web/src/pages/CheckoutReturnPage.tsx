import { useEffect, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Clock, CreditCard, Loader2, XCircle } from "lucide-react";
import type { PlanPayment } from "@rice-mill/shared";
import { billingService } from "../services/BillingService";

/** How long the page keeps asking before it says the payment is still on its way. */
const POLL_MS = 3000;
const GIVE_UP_AFTER = 20;

const amountOf = (p: PlanPayment) =>
  p.currency === "USD"
    ? `$${p.amount.toLocaleString(undefined, { maximumFractionDigits: 2 })} USD`
    : `₱${p.amount.toLocaleString()}`;

/**
 * Where PayMongo and PayPal send the mill after paying. It asks the backend to
 * confirm the payment with the provider (which turns the plan on once it's
 * paid) and keeps asking for a minute, since e-wallet payments can take a few
 * seconds to land.
 */
export default function CheckoutReturnPage() {
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const paymentId = params.get("payment") ?? "";
  const tries = useRef(0);

  const { data: payment, isError } = useQuery<PlanPayment>({
    queryKey: ["plan-payment", paymentId],
    queryFn: () => {
      tries.current += 1;
      return billingService.confirmPayment(paymentId);
    },
    enabled: !!paymentId,
    retry: 2,
    refetchInterval: (query) =>
      query.state.data?.status === "pending" && tries.current < GIVE_UP_AFTER ? POLL_MS : false,
  });

  const paid = payment?.status === "paid";
  useEffect(() => {
    // The plan changed: reload the signed-in user (plan, features) and Billing.
    if (!paid) return;
    qc.invalidateQueries({ queryKey: ["auth-me"] });
    qc.invalidateQueries({ queryKey: ["billing-my-request"] });
    qc.invalidateQueries({ queryKey: ["billing-plans"] });
  }, [paid, qc]);

  const stillPending = payment?.status === "pending";
  const gaveUp = stillPending && tries.current >= GIVE_UP_AFTER;

  let icon = <Loader2 size={40} className="mx-auto text-emerald-500 animate-spin" />;
  let title = "Checking your payment…";
  let body = "This takes a few seconds. Please keep this page open.";
  if (!paymentId || isError) {
    icon = <XCircle size={40} className="mx-auto text-rose-500" />;
    title = "We couldn't find that payment";
    body =
      "If money left your account, it is safe: we'll match it and turn your plan on. Contact us if it isn't on within a day.";
  } else if (paid) {
    icon = <CheckCircle2 size={40} className="mx-auto text-emerald-500" />;
    title = `You're on ${payment.plan_name}`;
    body = `We received ${amountOf(payment)}. Your plan is on now, and a receipt is on its way to your email.`;
  } else if (payment?.status === "failed") {
    icon = <XCircle size={40} className="mx-auto text-rose-500" />;
    title = "The payment didn't go through";
    body = "Nothing was charged. You can try again, or pick another way to pay.";
  } else if (gaveUp) {
    icon = <Clock size={40} className="mx-auto text-amber-500" />;
    title = "Your payment is still on its way";
    body =
      "Some payments take a few minutes to confirm. Your plan turns on by itself once it does, and we'll email you. You can leave this page.";
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="h-11 w-11 rounded-xl bg-grad-brand grid place-items-center shadow-grad-glow">
          <CreditCard size={20} className="text-white" />
        </div>
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-primary">Checkout</h2>
          <p className="text-sm text-secondary">Pay for your plan</p>
        </div>
      </div>
      <div className="card max-w-xl text-center py-8" role="status" aria-live="polite">
        {icon}
        <h3 className="text-xl font-bold text-primary mt-3">{title}</h3>
        <p className="text-sm text-secondary mt-1.5">{body}</p>
        {(!stillPending || gaveUp) && (
          <div className="mt-5 flex justify-center gap-2">
            {payment?.status === "failed" && (
              <Link
                to={`/settings/checkout?plan=${payment.plan_id}&interval=${payment.billing_interval}`}
                className="btn-primary"
              >
                Try again
              </Link>
            )}
            <Link to="/settings" className={paid ? "btn-primary" : "btn-secondary"}>
              Back to Billing
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
