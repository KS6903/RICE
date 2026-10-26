import { ShieldX } from "lucide-react";
import { Link } from "react-router-dom";
import { roleLabel as labelFor } from "@rice-mill/shared";
import { useAuthStore } from "../stores/authStore";
import { t } from "../i18n";
import { tx } from "../i18n/tx";

/**
 * Shown when a signed-in user navigates to a section their role can't access.
 * Not a security boundary on its own (the backend enforces writes) — it's the
 * friendly "this isn't part of your job" wall for the interface.
 */
export default function AccessDenied({ section }: { section?: string }) {
  const user = useAuthStore((s) => s.user);
  const roleLabel = labelFor(user?.role) || t("your role");

  return (
    <div className="flex items-center justify-center py-16">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 max-w-md w-full p-8 text-center">
        <div className="w-14 h-14 mx-auto bg-slate-100 dark:bg-slate-700 rounded-full flex items-center justify-center mb-4">
          <ShieldX size={24} className="text-slate-500 dark:text-slate-400" />
        </div>
        <h2 className="text-xl font-bold text-gray-900 dark:text-slate-100 mb-2">
          {t("No access to this section")}
        </h2>
        <p className="text-sm text-gray-600 dark:text-slate-300 mb-1">
          {section ? (
            <>
              {tx("The {{section}} section isn't available to your account.", {
                section: <span className="font-semibold capitalize">{section}</span>,
              })}
            </>
          ) : (
            <>{t("This section isn't available to your account.")}</>
          )}
        </p>
        <p className="text-xs text-gray-400 mb-4">
          {tx(
            "You're signed in as {{role}}. If you need access, ask the mill owner or an admin to update your role.",
            {
              role: (
                <span className="font-semibold text-gray-700 dark:text-slate-200">{roleLabel}</span>
              ),
            },
          )}
        </p>
        <Link to="/" className="btn-primary w-full justify-center">
          {t("Back to dashboard")}
        </Link>
      </div>
    </div>
  );
}
