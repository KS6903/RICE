import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, PauseCircle, Trash2 } from "lucide-react";
import { authService } from "../services/AuthService";
import { useAuthStore } from "../stores/authStore";
import ConfirmDialog from "./ConfirmDialog";
import PasswordInput from "./PasswordInput";

type Mode = "pause" | "delete";

/**
 * Settings > My Profile, for the Boss: pause the mill's account, or ask Oraiza
 * to delete it (Terms of Service 17.2). Either needs nothing left open with
 * Oraiza, and the Boss's password (and authenticator code) to confirm; asking
 * for deletion also takes the mill's name, typed out. Everyone is signed out.
 */
export default function AccountClosureCard() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const [mode, setMode] = useState<Mode | null>(null);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");

  const q = useQuery({
    queryKey: ["account-closure"],
    queryFn: () => authService.accountClosure(),
  });
  const close = useMutation({
    mutationFn: (m: Mode) =>
      authService.closeAccount({
        mode: m,
        current_password: password,
        ...(user?.mfa_enabled ? { mfa_code: code.trim() } : {}),
        ...(m === "delete" ? { confirm_name: name } : {}),
      }),
    onSuccess: async (_state, m) => {
      await logout();
      navigate(`/login?reason=${m === "delete" ? "account-deletion" : "account-paused"}`, {
        replace: true,
      });
    },
  });

  const info = q.data;
  const blockers = info?.blockers ?? [];
  const days = info?.export_window_days ?? 30;
  const open = (m: Mode) => {
    close.reset();
    setPassword("");
    setCode("");
    setName("");
    setMode(m);
  };
  const nameMatches =
    !!info && name.trim().toLowerCase() === info.company_name.trim().toLowerCase();
  const ready =
    password !== "" &&
    (!user?.mfa_enabled || /^\d{6}$/.test(code.trim())) &&
    (mode !== "delete" || nameMatches);

  return (
    <div className="card space-y-4 ring-1 ring-inset ring-rose-500/20">
      <div>
        <h3 className="text-lg font-bold text-primary">Close the mill&apos;s account</h3>
        <p className="text-sm text-secondary">
          <strong>Pause</strong> it to stop everyone using it for a while. Nothing is deleted, and
          you switch it back on when you next sign in. Or ask Oraiza to <strong>delete</strong> it:
          for {days} days you can still sign in to download your data or change your mind, and after
          that Oraiza deletes the mill&apos;s records.
        </p>
      </div>

      {blockers.length > 0 && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-xl px-4 py-3 bg-amber-50 dark:bg-amber-950/30 ring-1 ring-amber-200 dark:ring-amber-800/60"
        >
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600" aria-hidden />
          <div className="space-y-1 text-sm text-amber-800 dark:text-amber-200">
            <p className="font-semibold">Before you can close the account:</p>
            <ul className="list-disc space-y-0.5 pl-4">
              {blockers.map((b) => (
                <li key={b.code}>{b.message}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-secondary inline-flex items-center gap-1.5"
          disabled={!info || blockers.length > 0}
          onClick={() => open("pause")}
        >
          <PauseCircle size={15} aria-hidden /> Pause account
        </button>
        <button
          type="button"
          className="btn-danger inline-flex items-center gap-1.5"
          disabled={!info || blockers.length > 0}
          onClick={() => open("delete")}
        >
          <Trash2 size={15} aria-hidden /> Delete account
        </button>
      </div>

      <ConfirmDialog
        open={mode !== null}
        danger
        busy={close.isPending || !ready}
        title={mode === "delete" ? "Delete the mill's account?" : "Pause the mill's account?"}
        confirmLabel={mode === "delete" ? "Ask to delete it" : "Pause it"}
        onCancel={() => setMode(null)}
        onConfirm={() => mode && close.mutate(mode)}
      >
        <div className="space-y-3">
          <p>
            {mode === "delete"
              ? `Everyone is signed out and nobody else can sign in. For ${days} days you can sign in to download your data or take the request back; after that Oraiza deletes the mill's records.`
              : "Everyone is signed out and nobody else can sign in until you switch the account back on. Nothing is deleted."}
          </p>
          {mode === "delete" && (
            <div>
              <label htmlFor="close-name" className="form-label">
                Type the mill&apos;s name, <strong>{info?.company_name}</strong>, to confirm
              </label>
              <input
                id="close-name"
                className="input"
                autoComplete="off"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
          )}
          <div>
            <label htmlFor="close-password" className="form-label">
              Your password
            </label>
            <PasswordInput
              id="close-password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {user?.mfa_enabled && (
            <div>
              <label htmlFor="close-code" className="form-label">
                Authenticator code
              </label>
              <input
                id="close-code"
                className="input"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </div>
          )}
          {close.isError && (
            <p className="font-medium text-rose-600 dark:text-rose-400">
              {(close.error as any)?.response?.data?.detail || "Couldn't close the account."}
            </p>
          )}
        </div>
      </ConfirmDialog>
    </div>
  );
}
