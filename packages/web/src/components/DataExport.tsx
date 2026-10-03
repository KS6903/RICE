// Settings → Your data: the owner downloads everything the mill keeps with us,
// as the data processing agreement promises. Works on every plan, and after a
// plan ends.
import { useMutation } from "@tanstack/react-query";
import { Download, Loader2, ShieldAlert } from "lucide-react";
import { isAxiosError } from "axios";
import { dataExportService } from "../services/DataExportService";

function save(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function DataExport() {
  const download = useMutation({
    mutationFn: () => dataExportService.download(),
    onSuccess: ({ blob, filename }) => save(blob, filename),
  });
  const tooMany = isAxiosError(download.error) && download.error.response?.status === 429;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-bold text-primary">Your data</h3>
        <p className="text-sm text-secondary">
          Download everything your mill keeps in Oryza, as spreadsheet files you can open in Excel
          or Google Sheets.
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
            The file holds personal data. Keep it where only the people who need it can open it. We
            email you each time it&apos;s downloaded, and it&apos;s recorded in the activity log.
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
            <span className="text-sm text-emerald-700 dark:text-emerald-300" role="status">
              Downloaded {download.data.filename}
            </span>
          )}
        </div>
        {download.isError && (
          <p className="text-sm text-rose-600 dark:text-rose-400" role="alert">
            {tooMany
              ? "You've downloaded it a few times this hour. Try again later."
              : "Couldn't prepare the file. Try again in a moment."}
          </p>
        )}
      </div>
    </div>
  );
}
