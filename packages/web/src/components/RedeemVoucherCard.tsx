import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, Ticket } from "lucide-react";
import { format } from "date-fns";
import { voucherService } from "../services/BillingService";
import { useAuthStore } from "../stores/authStore";
import ConfirmItsYou, { type Proof } from "./ConfirmItsYou";
import { t } from "../i18n";

function errorText(e: any, fallback: string): string {
  const detail = e?.response?.data?.detail;
  return typeof detail === "string" ? detail : fallback;
}

/**
 * Settings > Billing: a voucher BossAdmin gave the mill. One that gives free
 * time on a plan turns it on here, after the Boss confirms it's them; one that
 * takes money off is typed at checkout instead.
 */
export default function RedeemVoucherCard() {
  const qc = useQueryClient();
  const usesCode = useAuthStore((s) => !!s.user?.mfa_enabled);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState<{ error?: string } | null>(null);
  const [done, setDone] = useState<{ plan_name: string; expires_at: string } | null>(null);

  const check = useMutation({
    mutationFn: () => voucherService.check({ code }),
    onSuccess: (result) => {
      if (result.voucher.kind !== "free_time") {
        setError(t("This voucher takes money off a payment. Pick a plan and type it at checkout."));
        return;
      }
      setError(null);
      setAsking({});
    },
    onError: (e) => setError(errorText(e, t("That voucher code isn't valid."))),
  });

  const redeem = useMutation({
    mutationFn: (proof: Proof) =>
      voucherService.redeem({
        code,
        current_password: proof.password,
        mfa_code: proof.code || undefined,
      }),
    onSuccess: ({ redeemed }) => {
      setDone(redeemed);
      setCode("");
      // The plan, its features and the pages it opens all come from /me.
      qc.invalidateQueries();
    },
    onError: (e: any) => {
      if (e?.response?.data?.code === "confirm_failed") {
        setAsking({ error: errorText(e, t("That didn't work.")) });
        return;
      }
      setError(errorText(e, t("The voucher couldn't be used. Try again.")));
    },
  });

  return (
    <div className="card space-y-3">
      <div className="flex items-center gap-2">
        <Ticket size={18} className="text-emerald-600 dark:text-emerald-400" />
        <h3 className="text-lg font-bold text-primary">{t("Have a voucher?")}</h3>
      </div>
      {done ? (
        <p className="flex items-start gap-2 text-sm text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 size={16} className="shrink-0 mt-0.5" />
          {t("Done. {{plan}} is on until {{date}}.", {
            plan: done.plan_name,
            date: format(new Date(done.expires_at), "MMMM d, yyyy"),
          })}
        </p>
      ) : (
        <form
          className="flex gap-2 flex-wrap"
          onSubmit={(e) => {
            e.preventDefault();
            if (code.trim()) check.mutate();
          }}
        >
          <input
            className="input font-mono uppercase flex-1 min-w-48"
            value={code}
            maxLength={60}
            autoComplete="off"
            aria-label={t("Voucher code")}
            placeholder="ABCD-EFGH-JKMN"
            onChange={(e) => {
              setCode(e.target.value.toUpperCase());
              setError(null);
            }}
          />
          <button
            type="submit"
            className="btn-primary"
            disabled={!code.trim() || check.isPending || redeem.isPending}
          >
            {check.isPending || redeem.isPending ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Ticket size={14} />
            )}{" "}
            {t("Redeem")}
          </button>
        </form>
      )}
      {error && <p className="text-sm font-medium text-rose-600 dark:text-rose-400">{error}</p>}
      <p className="text-xs text-muted">
        {t("A voucher works only for the account it was given to, once.")}
      </p>

      <ConfirmItsYou
        key={asking?.error ?? "first"}
        open={!!asking}
        usesCode={usesCode}
        reason={t("Changing the plan needs you to confirm it's you.")}
        error={asking?.error}
        onConfirm={(proof) => {
          setAsking(null);
          redeem.mutate(proof);
        }}
        onCancel={() => setAsking(null)}
      />
    </div>
  );
}
