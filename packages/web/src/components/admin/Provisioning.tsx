// A tenant's schema setup, as the admin console shows it: a badge in the tenant
// list, and on the tenant page the state, the last error and a Retry button.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { RotateCcw } from "lucide-react";
import { adminService } from "../../services/AdminService";
import { t } from "../../i18n";

export type ProvisioningInfo = {
  state: "provisioned" | "queued" | "retrying" | "failed" | "not_requested";
  attempts: number;
  max_attempts: number;
  error: string | null;
  requested_at: string | null;
  next_attempt_at: string | null;
  provisioned_at: string | null;
};

/** Nothing for a set-up tenant; otherwise where its setup stands. */
export function ProvisioningBadge({ info }: { info?: ProvisioningInfo }) {
  if (!info || info.state === "provisioned") return null;
  if (info.state === "failed") return <span className="badge-red">{t("Setup failed")}</span>;
  if (info.state === "retrying")
    return (
      <span className="badge-yellow">
        {t("Setup retrying ({{attempts}}/{{max_attempts}})", {
          attempts: info.attempts,
          max_attempts: info.max_attempts,
        })}
      </span>
    );
  if (info.state === "queued") return <span className="badge-yellow">{t("Setting up")}</span>;
  return <span className="badge-gray">{t("Not set up")}</span>;
}

export function ProvisioningPanel({
  tenantId,
  info,
}: {
  tenantId: string;
  info?: ProvisioningInfo;
}) {
  const qc = useQueryClient();
  const retry = useMutation({
    mutationFn: () => adminService.retryProvisioning(tenantId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-tenant", tenantId] });
      qc.invalidateQueries({ queryKey: ["admin-tenants"] });
    },
  });
  if (!info || info.state === "provisioned") return null;
  const when = (iso: string | null) => (iso ? format(new Date(iso), "MMM d, h:mm a") : "—");

  return (
    <section
      className="card space-y-3 border border-amber-200 dark:border-amber-900/50"
      aria-labelledby="provisioning-h"
    >
      <div className="flex items-center gap-3 flex-wrap">
        <h3 id="provisioning-h" className="font-semibold text-primary">
          {t("Account setup")}
        </h3>
        <ProvisioningBadge info={info} />
      </div>
      <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-muted">{t("Requested")}</dt>
          <dd className="text-primary">{when(info.requested_at)}</dd>
        </div>
        <div>
          <dt className="text-muted">{t("Attempts")}</dt>
          <dd className="text-primary tabular-nums">
            {t("{{attempts}} of {{max_attempts}}", {
              attempts: info.attempts,
              max_attempts: info.max_attempts,
            })}
          </dd>
        </div>
        <div>
          <dt className="text-muted">{t("Next attempt")}</dt>
          <dd className="text-primary">
            {info.state === "failed" ? t("None: retries used up") : when(info.next_attempt_at)}
          </dd>
        </div>
      </dl>
      {info.error && <p className="text-sm text-rose-700 dark:text-rose-300">{info.error}</p>}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="button"
          className="btn-secondary"
          onClick={() => retry.mutate()}
          disabled={retry.isPending}
        >
          <RotateCcw size={15} />
          {retry.isPending ? t("Starting…") : t("Retry setup now")}
        </button>
        <span className="text-xs text-muted">
          {t("Clears the failures and starts the provisioner straight away.")}
        </span>
      </div>
      {retry.isError && (
        <p className="text-sm text-rose-600 dark:text-rose-400" role="alert">
          {t("Couldn't start the retry. Try again in a moment.")}
        </p>
      )}
    </section>
  );
}
