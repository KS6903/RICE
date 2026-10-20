// "Upload your data": load a backup file into this new, empty account. Shown in
// Settings → Your data while the account has nothing in it, and on
// /retrieve-data. The server checks everything: the file, the email it's tied
// to, that the account is empty and its login new, and the plan's branches.
import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Info, Loader2, RotateCcw, Upload } from "lucide-react";
import { isAxiosError } from "axios";
import {
  dataExportService,
  type BackupSummary,
  type RestoreProof,
} from "../services/DataExportService";
import ConfirmItsYou from "./ConfirmItsYou";
import { useAuthStore } from "../stores/authStore";
import { DONE_TEXT, ERROR_TEXT, madeOn, problem } from "../utils/backup";

export default function LoadBackup() {
  const qc = useQueryClient();
  const usesCode = !!useAuthStore((s) => s.user)?.mfa_enabled;
  const picker = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [asking, setAsking] = useState<{ error?: string } | null>(null);

  const inspect = useMutation({
    mutationFn: (chosen: File) => dataExportService.inspectBackup(chosen),
  });
  const load = useMutation({
    mutationFn: (proof: RestoreProof) => dataExportService.restoreBackup(file as File, proof),
    // Every page shows the loaded records from here on.
    onSuccess: () => qc.invalidateQueries(),
    onError: (e) => {
      // A turned-down password or code is asked for again, in the popup.
      if (isAxiosError(e) && e.response?.data?.code === "confirm_failed") {
        setAsking({ error: problem(e, "That didn't work.") });
      }
    },
  });

  const choose = (chosen: File | null) => {
    setFile(chosen);
    load.reset();
    inspect.reset();
    if (chosen) inspect.mutate(chosen);
  };

  const summary: BackupSummary | undefined = inspect.data;
  const loaded: BackupSummary | undefined = load.data;

  return (
    <div className="card space-y-4">
      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
          <Upload size={18} aria-hidden />
        </div>
        <div className="min-w-0">
          <p className="font-semibold text-primary">Upload your data</p>
          <p className="text-sm text-secondary">
            Choose the .oraiza backup from your old account. We check the whole file before anything
            is loaded.
          </p>
        </div>
      </div>

      <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-sky-500/10 ring-1 ring-inset ring-sky-500/30 text-sm text-sky-900 dark:text-sky-100">
        <Info size={16} className="mt-0.5 shrink-0" />
        <span>
          The backup&apos;s records come into this account: purchases, milling, stock, sales,
          employees and the rest, with their branches. Staff logins don&apos;t come with it, so add
          your staff again under Users afterwards.
        </span>
      </div>

      {!loaded && (
        <div className="flex items-center gap-3 flex-wrap">
          <input
            ref={picker}
            id="backup-file"
            type="file"
            accept=".oraiza"
            className="sr-only"
            onChange={(e) => {
              choose(e.target.files?.[0] ?? null);
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
          {file && (
            <span className="text-sm text-secondary truncate max-w-full" title={file.name}>
              {file.name}
            </span>
          )}
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

      {summary && !loaded && (
        <div className="space-y-3">
          <p className="text-sm text-primary" role="status">
            A backup of <strong>{summary.company}</strong>, made {madeOn(summary.created_at)} by{" "}
            {summary.created_by}: {summary.rows.toLocaleString("en-PH")} records
            {summary.branches > 1 ? ` in ${summary.branches} branches` : ""}.
          </p>
          <button
            type="button"
            className="btn-primary"
            onClick={() => setAsking({})}
            disabled={load.isPending}
          >
            {load.isPending ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <RotateCcw size={16} />
            )}
            {load.isPending ? "Loading your records…" : "Load this backup"}
          </button>
        </div>
      )}

      {load.isError && !asking && (
        <p className={ERROR_TEXT} role="alert">
          {problem(load.error, "Couldn't load the backup. Nothing was changed.")}
        </p>
      )}
      {loaded && (
        <div className="space-y-3">
          <p className={`${DONE_TEXT} inline-flex items-start gap-2`} role="status">
            <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
            Loaded {loaded.rows.toLocaleString("en-PH")} records from {loaded.company}&apos;s
            backup, made {madeOn(loaded.created_at)}. Add your staff again under Users.
          </p>
          <div className="flex gap-2 flex-wrap">
            <Link to="/" className="btn-primary">
              Go to your dashboard
            </Link>
            <Link to="/users" className="btn-secondary">
              Add your staff
            </Link>
          </div>
        </div>
      )}

      <ConfirmItsYou
        open={!!asking}
        reason="Loading puts the backup's records into this account."
        usesCode={usesCode}
        error={asking?.error}
        onConfirm={(p) => {
          setAsking(null);
          load.mutate({ password: p.password, code: p.code });
        }}
        onCancel={() => setAsking(null)}
      />
    </div>
  );
}
