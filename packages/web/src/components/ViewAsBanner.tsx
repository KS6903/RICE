import { useEffect, useState } from "react";
import { Eye, ShieldAlert, X } from "lucide-react";
import { useAuthStore } from "../stores/authStore";
import { reloadAs, stopViewAs } from "../services/api";
import { t } from "../i18n";

function minutesLeft(expires: string | null | undefined): number | null {
  if (!expires) return null;
  return Math.max(0, Math.ceil((new Date(expires).getTime() - Date.now()) / 60000));
}

/**
 * Shown on every page while BossAdmin is looking at a mill through "View as":
 * whose eyes, read-only or full control, how long is left, and the way back.
 */
export default function ViewAsBanner() {
  const user = useAuthStore((s) => s.user);
  const visit = user?.viewing_as;
  const [, tick] = useState(0);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (!visit) return;
    const id = window.setInterval(() => tick((n) => n + 1), 30_000);
    return () => window.clearInterval(id);
  }, [visit]);

  if (!visit || !user) return null;
  const full = visit.mode === "full";
  const left = minutesLeft(visit.expires_at);
  const name = user.full_name || user.username;

  const back = async () => {
    setLeaving(true);
    await stopViewAs();
    await reloadAs(user.company_id ? `/admin/tenants/${user.company_id}` : "/admin");
  };

  return (
    <div
      role="status"
      className={`fixed inset-x-0 bottom-0 z-90 flex justify-center px-4 pb-[max(env(safe-area-inset-bottom),12px)] pointer-events-none`}
    >
      <div
        className={`pointer-events-auto flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-2xl px-4 py-2.5 text-sm shadow-lg ring-1 max-w-full ${
          full
            ? "bg-rose-600 text-white ring-rose-700"
            : "bg-amber-400 text-amber-950 ring-amber-500"
        }`}
      >
        {full ? <ShieldAlert size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
        <span className="font-semibold">
          {t("BossAdmin view: {{mill}} as {{name}}", {
            mill: visit.company_name ?? t("this mill"),
            name,
          })}
        </span>
        <span className="opacity-90">
          {full ? t("Full control: changes are real") : t("Read-only")}
          {left !== null && ` · ${t("{{count}} min left", { count: left })}`}
        </span>
        <button
          type="button"
          onClick={back}
          disabled={leaving}
          className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 font-semibold ${
            full ? "bg-white/20 hover:bg-white/30" : "bg-amber-950/10 hover:bg-amber-950/20"
          }`}
        >
          <X size={14} aria-hidden /> {t("Back to BossAdmin")}
        </button>
      </div>
    </div>
  );
}
