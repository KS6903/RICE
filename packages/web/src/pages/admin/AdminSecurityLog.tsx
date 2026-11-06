import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Lock, ShieldCheck, Unlock } from "lucide-react";
import { format } from "date-fns";
import { adminService } from "../../services/AdminService";
import { t } from "../../i18n";

const ACTION_TEXT: Record<string, string> = {
  "admin.change": t("Change"),
  "admin.confirmed": t("Confirmed it's you"),
  "view_as.start": t("View as"),
  "view_as.change": t("Change through View as"),
  "auth.login": t("Signed in"),
  "auth.login_failed": t("Wrong password"),
  "auth.mfa_failed": t("Wrong authenticator code"),
  "auth.confirm_failed": t("Confirmation failed"),
  "auth.mfa_enabled": t("Two-factor turned on"),
  "auth.mfa_disabled": t("Two-factor turned off"),
  "auth.password_changed": t("Password changed"),
  "auth.session_revoked": t("Signed out a device"),
  "auth.sessions_revoked_others": t("Signed out other devices"),
};

const ALARMING = new Set([
  "auth.login_failed",
  "auth.mfa_failed",
  "auth.confirm_failed",
  "auth.mfa_disabled",
  "view_as.change",
]);

/**
 * Everything the BossAdmin account did and every security event on it, newest
 * first (backend admin_audit_log: the app can add to it, never change or delete
 * it). Also the lock: end the current "confirm it's you" window at once.
 */
export default function AdminSecurityLog() {
  const qc = useQueryClient();
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["admin-audit-log"],
    queryFn: () => adminService.auditLog(),
    refetchInterval: 60_000,
  });
  const { data: status } = useQuery({
    queryKey: ["admin-confirm-status"],
    queryFn: () => adminService.confirmStatus(),
    refetchInterval: 30_000,
  });
  const lock = useMutation({
    mutationFn: () => adminService.endConfirmation(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-confirm-status"] }),
  });
  const open = !!status?.confirmed_until;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="h-11 w-11 rounded-xl bg-grad-brand grid place-items-center shadow-grad-glow">
          <ShieldCheck size={20} className="text-white" />
        </div>
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-primary">{t("Security log")}</h2>
          <p className="text-sm text-secondary">
            {t("What this account did, and every sign-in and check on it.")}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2 text-sm">
          {open ? (
            <>
              <span className="badge-yellow inline-flex items-center gap-1">
                <Unlock size={12} />
                {t("Changes allowed until {{time}}", {
                  time: format(new Date(status!.confirmed_until!), "h:mm a"),
                })}
              </span>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => lock.mutate()}
                disabled={lock.isPending}
              >
                <Lock size={14} /> {t("Lock now")}
              </button>
            </>
          ) : (
            <span className="badge-green inline-flex items-center gap-1">
              <Lock size={12} /> {t("Locked: changes ask for your password and code")}
            </span>
          )}
        </div>
      </div>

      <div className="panel">
        <table className="data-table">
          <thead>
            <tr>
              <th>{t("When")}</th>
              <th>{t("What")}</th>
              <th>{t("Mill")}</th>
              <th>{t("Detail")}</th>
              <th>{t("From")}</th>
            </tr>
          </thead>
          <tbody>
            {isLoading &&
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i}>
                  <td colSpan={5}>
                    <div className="skeleton h-4 w-2/3" />
                  </td>
                </tr>
              ))}
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="text-xs whitespace-nowrap text-secondary">
                  {format(new Date(r.created_at), "MMM d, yyyy, h:mm:ss a")}
                </td>
                <td>
                  <span className={ALARMING.has(r.action) ? "badge-red" : "badge-gray"}>
                    {ACTION_TEXT[r.action] ?? r.action}
                  </span>
                  {r.method && (
                    <div className="mt-1 font-mono text-[11px] text-muted break-all">
                      {r.method} {r.path}
                    </div>
                  )}
                </td>
                <td className="text-xs">
                  {r.company_id ? (
                    <Link to={`/admin/tenants/${r.company_id}`} className="link">
                      {r.company_name ?? r.company_id}
                    </Link>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
                <td className="text-xs text-secondary break-words max-w-xs">{r.detail || "—"}</td>
                <td className="text-xs text-muted">
                  <div className="font-mono">{r.ip_address || "—"}</div>
                  {r.user_agent && (
                    <div className="truncate max-w-48" title={r.user_agent}>
                      {r.user_agent}
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {!isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={5} className="py-10! text-center text-sm text-muted">
                  {t("Nothing yet.")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
