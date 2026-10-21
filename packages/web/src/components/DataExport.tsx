// Settings → Your data: the owner downloads everything the mill keeps with us,
// as the data processing agreement promises. Works on every plan, and after a
// plan ends. Below it, the backup file: one file only this app can open, tied
// to the owner's email, which loads into a new account (LoadBackup).
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Download, FileLock2, Loader2, ShieldAlert } from "lucide-react";
import { isAxiosError } from "axios";
import { dataExportService } from "../services/DataExportService";
import LoadBackup from "./LoadBackup";
import { DONE_TEXT, ERROR_TEXT, problem, save } from "../utils/backup";

export default function DataExport() {
  const download = useMutation({
    mutationFn: () => dataExportService.download(),
    onSuccess: ({ blob, filename }) => save(blob, filename),
  });
  const tooMany = isAxiosError(download.error) && download.error.response?.status === 429;

  return (
    <div className="space-y-10">
      <div className="space-y-4">
        <div>
          <h3 className="text-lg font-bold text-primary">Your data</h3>
          <p className="text-sm text-secondary">
            Download everything your mill keeps in Oraiza, as spreadsheet files you can open in
            Excel or Google Sheets.
          </p>
        </div>

        <div className="card space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 text-sm">
            <div>
              <p className="font-semibold text-primary mb-1">Included</p>
              <ul className="list-disc pl-5 space-y-0.5 text-secondary">
                <li>Your company, branches and users</li>
                <li>Palay purchases, milling, inventory and warehouses</li>
                <li>Sales, payments, expenses and deliveries</li>
                <li>Employees, with their government ID numbers</li>
                <li>Automations, notifications and the activity log</li>
              </ul>
            </div>
            <div>
              <p className="font-semibold text-primary mb-1">Not included</p>
              <ul className="list-disc pl-5 space-y-0.5 text-secondary">
                <li>Passwords and two-factor keys</li>
                <li>Copies of report files we already emailed you</li>
              </ul>
            </div>
          </div>

          <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-amber-500/15 ring-1 ring-inset ring-amber-500/40 text-sm text-amber-800 dark:text-amber-200">
            <ShieldAlert size={16} className="mt-0.5 shrink-0" />
            <span>
              The file holds personal data. Keep it where only the people who need it can open it.
              We email you each time it&apos;s downloaded, and it&apos;s recorded in the activity
              log.
            </span>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <button
              type="button"
              className="btn-primary"
              onClick={() => download.mutate()}
              disabled={download.isPending}
            >
              {download.isPending ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Download size={16} />
              )}
              {download.isPending ? "Preparing your file…" : "Download all data (.zip)"}
            </button>
            {download.isSuccess && (
              <span className={DONE_TEXT} role="status">
                Downloaded {download.data.filename}
              </span>
            )}
          </div>
          {download.isError && (
            <p className={ERROR_TEXT} role="alert">
              {tooMany
                ? "You've downloaded it a few times this hour. Try again later."
                : "Couldn't prepare the file. Try again in a moment."}
            </p>
          )}
        </div>
      </div>

      <BackupAndRestore />
    </div>
  );
}

function BackupAndRestore() {
  const status = useQuery({
    queryKey: ["backup-status"],
    queryFn: () => dataExportService.backupStatus(),
  });
  const backup = useMutation({
    mutationFn: () => dataExportService.downloadBackup(),
    onSuccess: ({ blob, filename }) => save(blob, filename),
  });
  const email = status.data?.email;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-bold text-primary">Backup and restore</h3>
        <p className="text-sm text-secondary">
          A backup is one file that only Oraiza can open. Nobody can read it or change it, and a
          changed file won&apos;t upload. It loads into a new account made with your email address,
          so you can bring your records back if you ever start over.
        </p>
      </div>

      <div className="card space-y-3">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
            <FileLock2 size={18} aria-hidden />
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-primary">Download a backup</p>
            <p className="text-sm text-secondary">
              Every record your mill keeps, sealed in one .oraiza file. Keep it somewhere safe. We
              email you each time one is downloaded.
            </p>
            {email && (
              <p className="text-sm text-secondary mt-1">
                It opens only for an account with the email <strong>{email}</strong>.
              </p>
            )}
            {status.isSuccess && !email && (
              <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                Add an email address under My Profile first. A backup opens only for an account with
                that email.
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => backup.mutate()}
            disabled={backup.isPending || (status.isSuccess && !email)}
          >
            {backup.isPending ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Download size={16} />
            )}
            {backup.isPending ? "Sealing your backup…" : "Download a backup (.oraiza)"}
          </button>
          {backup.isSuccess && (
            <span className={DONE_TEXT} role="status">
              Downloaded {backup.data.filename}
            </span>
          )}
        </div>
        {backup.isError && (
          <p className={ERROR_TEXT} role="alert">
            {problem(backup.error, "Couldn't prepare the backup. Try again in a moment.")}
          </p>
        )}
      </div>

      {status.data?.empty ? (
        <LoadBackup />
      ) : (
        status.data && (
          <p className="text-sm text-secondary">
            Uploading a backup works only in a new account that has nothing in it yet.{" "}
            <Link to="/retrieve-data" className="font-semibold text-emerald-700 underline">
              How to retrieve your data
            </Link>
          </p>
        )
      )}
    </div>
  );
}
