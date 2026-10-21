// BossAdmin: load a backup into an empty tenant, straight from the tenant page.
// None of the owner's checks (a confirmed email on the account, a new login,
// their password, the plan's branches): the server keeps only that the tenant
// is empty and that the file opens for the email it was made for
// (data_backup.restore_as_admin). Choosing a file checks it; loading is the
// second, deliberate step.
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, RotateCcw, Upload } from "lucide-react";
import { adminService } from "../../services/AdminService";
import type { BackupSummary } from "../../services/DataExportService";
import { DONE_TEXT, ERROR_TEXT, madeOn, problem } from "../../utils/backup";

export default function TenantBackupLoad({
  tenantId,
  tenantName,
}: {
  tenantId: string;
  tenantName?: string;
}) {
  const qc = useQueryClient();
  const picker = useRef<HTMLInputElement>(null);
  const status = useQuery({
    queryKey: ["admin-tenant-backup", tenantId],
    queryFn: () => adminService.getTenantBackupStatus(tenantId),
  });
  const [file, setFile] = useState<File | null>(null);
  // null until the admin types one: the Boss's own email is the default.
  const [typed, setTyped] = useState<string | null>(null);
  const email = typed ?? status.data?.owner_email ?? "";

  const inspect = useMutation({
    mutationFn: (chosen: File) => adminService.inspectTenantBackup(tenantId, chosen, email),
  });
  const load = useMutation({
    mutationFn: () => adminService.restoreTenantBackup(tenantId, file as File, email),
    onSuccess: () => {
      for (const key of ["admin-tenant", "admin-tenant-activity", "admin-tenant-backup"]) {
        qc.invalidateQueries({ queryKey: [key, tenantId] });
      }
    },
  });

  const check = (chosen: File | null) => {
    setFile(chosen);
    load.reset();
    inspect.reset();
    if (chosen) inspect.mutate(chosen);
  };

  const summary: BackupSummary | undefined = inspect.data;
  const loaded: BackupSummary | undefined = load.data;
  const open = status.data?.empty && status.data.has_boss;

  return (
    <div className="card space-y-4">
      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
          <Upload size={18} aria-hidden />
        </div>
        <div className="min-w-0">
          <h3 className="font-semibold text-primary">Load a backup</h3>
          <p className="text-sm text-secondary">
            Put a mill&apos;s .oraiza backup into this tenant while it&apos;s empty. Its records
            belong to this tenant&apos;s Boss.
          </p>
        </div>
      </div>

      {status.isPending && <p className="text-sm text-muted">Checking the tenant…</p>}
      {status.isError && (
        <p className={ERROR_TEXT} role="alert">
          {problem(status.error, "Couldn't check the tenant. Try again in a moment.")}
        </p>
      )}
      {status.data && !status.data.has_boss && !loaded && (
        <p className="text-sm text-secondary">
          This tenant has no Boss login to own the records, so a backup can&apos;t be loaded.
        </p>
      )}
      {status.data && status.data.has_boss && !status.data.empty && !loaded && (
        <p className="text-sm text-secondary">
          This tenant already has records of its own. A backup loads only into an empty tenant.
        </p>
      )}

      {open && !loaded && (
        <div className="space-y-3">
          <div>
            <label className="form-label" htmlFor="tenant-backup-email">
              The backup&apos;s email
            </label>
            <input
              id="tenant-backup-email"
              type="email"
              className="input"
              value={email}
              onChange={(e) => {
                setTyped(e.target.value);
                inspect.reset();
              }}
              placeholder="owner@mill.ph"
              autoComplete="off"
            />
            <p className="mt-1.5 text-xs text-muted">
              A backup opens only for the email of the owner who downloaded it. This tenant&apos;s
              Boss&apos;s is filled in.
            </p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <input
              ref={picker}
              id="tenant-backup-file"
              type="file"
              accept=".oraiza"
              className="sr-only"
              onChange={(e) => {
                check(e.target.files?.[0] ?? null);
                // Choosing the same file again still checks it again.
                e.target.value = "";
              }}
            />
            <button
              type="button"
              className="btn-secondary"
              onClick={() => picker.current?.click()}
              disabled={inspect.isPending || load.isPending}
            >
              <Upload size={16} /> {file ? "Choose another file" : "Choose a backup file"}
            </button>
            {file && !inspect.isPending && !summary && (
              <button type="button" className="btn-secondary" onClick={() => check(file)}>
                Check again
              </button>
            )}
            {file && (
              <span className="text-sm text-secondary truncate max-w-full" title={file.name}>
                {file.name}
              </span>
            )}
          </div>
        </div>
      )}

      {inspect.isPending && (
        <p className="text-sm text-secondary inline-flex items-center gap-2" role="status">
          <Loader2 size={16} className="animate-spin" /> Checking the file…
        </p>
      )}
      {inspect.isError && (
        <p className={ERROR_TEXT} role="alert">
          {problem(inspect.error, "Couldn't check that file. Try again in a moment.")}
        </p>
      )}

      {open && summary && !loaded && (
        <div className="space-y-3">
          <p className="text-sm text-primary" role="status">
            A backup of <strong>{summary.company}</strong>, made {madeOn(summary.created_at)} by{" "}
            {summary.created_by}: {summary.rows.toLocaleString("en-PH")} records
            {summary.branches > 1 ? ` in ${summary.branches} branches` : ""}.
          </p>
          <button
            type="button"
            className="btn-primary"
            onClick={() => load.mutate()}
            disabled={load.isPending}
          >
            {load.isPending ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <RotateCcw size={16} />
            )}
            {load.isPending ? "Loading the records…" : `Load into ${tenantName ?? "this tenant"}`}
          </button>
        </div>
      )}

      {load.isError && (
        <p className={ERROR_TEXT} role="alert">
          {problem(load.error, "Couldn't load the backup. Nothing was changed.")}
        </p>
      )}
      {loaded && (
        <p className={`${DONE_TEXT} inline-flex items-start gap-2`} role="status">
          <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
          Loaded {loaded.rows.toLocaleString("en-PH")} records from {loaded.company}&apos;s backup,
          made {madeOn(loaded.created_at)}. Staff logins aren&apos;t part of a backup, so the Boss
          adds them again under Users.
        </p>
      )}
    </div>
  );
}
