// /retrieve-data: bring a mill's records back from a backup file into a new
// account. Open to anyone; what it shows depends on who is signed in. For
// security the records go into a new account with a new username and password,
// made with the old account's email, which the backup is tied to.
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, FileLock2, Loader2 } from "lucide-react";
import { useAuthStore } from "../stores/authStore";
import { dataExportService } from "../services/DataExportService";
import LoadBackup from "../components/LoadBackup";
import { ERROR_TEXT, problem } from "../utils/backup";
import { withNext } from "../utils/next";

const HERE = "/retrieve-data";

export default function RetrieveDataPage() {
  const signedIn = useAuthStore((s) => s.isAuthenticated());
  const user = useAuthStore((s) => s.user);

  return (
    <div className="min-h-screen grid place-items-center p-6 bg-grad-brand-anim">
      <div className="w-full max-w-xl card animate-grad-fade-up space-y-6">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-xl bg-grad-brand grid place-items-center shadow-grad-glow">
            <FileLock2 size={20} className="text-white" />
          </div>
          <p className="text-lg font-bold tracking-tight text-primary">Oraiza</p>
        </div>

        <div>
          <h1 className="text-2xl font-bold tracking-tight text-primary">Retrieve your data</h1>
          <p className="mt-2 text-sm text-secondary">
            Bring your mill&apos;s records back from a backup file (.oraiza). For your security,
            they go into a new account with a new username and password.
          </p>
        </div>

        {!signedIn || !user ? (
          <SignedOut />
        ) : user.is_platform_admin ? (
          <p className="text-sm text-secondary">
            This page is for mill owners. Platform admins can&apos;t load a backup.
          </p>
        ) : user.role !== "owner" ? (
          <p className="text-sm text-secondary">
            Only the account&apos;s Boss can load a backup. Ask them to sign in here.
          </p>
        ) : (
          <SignedInOwner />
        )}
      </div>
    </div>
  );
}

function SignedOut() {
  return (
    <div className="space-y-5">
      <ol className="space-y-3 text-sm text-secondary">
        {[
          "Create a new account with a new username and password. Use the same email address as your old account: the backup opens only for it.",
          "Confirm your email from the link we send you.",
          "Come back to this page and upload your backup.",
        ].map((step, i) => (
          <li key={step} className="flex gap-3">
            <span className="h-6 w-6 shrink-0 rounded-full grid place-items-center text-xs font-bold ring-1 ring-inset ring-slate-300 dark:ring-slate-600">
              {i + 1}
            </span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
      <div className="flex gap-2 flex-wrap">
        <Link to={withNext("/signup", HERE)} className="btn-primary">
          Create a new account
        </Link>
        <Link to={withNext("/login", HERE)} className="btn-secondary">
          I made one: sign in
        </Link>
      </div>
      <p className="text-xs text-muted">
        An email address belongs to one account at a time. If your old account still uses it, change
        the email there first.
      </p>
      <Link
        to="/"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-primary"
      >
        <ArrowLeft size={14} /> Back to the home page
      </Link>
    </div>
  );
}

function SignedInOwner() {
  const logout = useAuthStore((s) => s.logout);
  const status = useQuery({
    queryKey: ["backup-status"],
    queryFn: () => dataExportService.backupStatus(),
    retry: false,
  });

  if (status.isPending) {
    return (
      <p className="text-sm text-secondary inline-flex items-center gap-2" role="status">
        <Loader2 size={16} className="animate-spin" /> Checking your account…
      </p>
    );
  }
  if (status.isError) {
    return (
      <p className={ERROR_TEXT} role="alert">
        {problem(status.error, "Couldn't check your account. Try again in a moment.")}
      </p>
    );
  }
  if (!status.data.empty) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-secondary">
          This account already has records of its own. A backup loads only into a new account that
          has nothing in it yet. To bring a backup back, sign out and create a new account with a
          new username and password.
        </p>
        <div className="flex gap-2 flex-wrap">
          <Link to="/" className="btn-secondary">
            Back to the app
          </Link>
          <button type="button" className="btn-secondary" onClick={() => void logout()}>
            Sign out
          </button>
        </div>
      </div>
    );
  }
  if (!status.data.email || !status.data.email_verified) {
    return (
      <p className="text-sm text-secondary">
        Confirm your email address first: the backup opens only for a confirmed email, the same one
        your old account used. Add or confirm it under{" "}
        <Link to="/settings" className="font-semibold text-emerald-700 underline">
          Settings
        </Link>{" "}
        → Profile.
      </p>
    );
  }
  return <LoadBackup />;
}
