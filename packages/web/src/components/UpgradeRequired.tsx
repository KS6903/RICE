import { Lock, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import { useCurrentPlan } from "../hooks/useFeature";
import { t } from "../i18n";
import { tx } from "../i18n/tx";

export default function UpgradeRequired({
  feature,
  requires = t("Pro or Enterprise"),
}: {
  feature: string;
  requires?: string;
}) {
  const plan = useCurrentPlan();
  return (
    <div className="flex items-center justify-center py-16">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-amber-200 dark:border-amber-800 max-w-md w-full p-8 text-center">
        <div className="w-14 h-14 mx-auto bg-amber-100 dark:bg-amber-900/40 rounded-full flex items-center justify-center mb-4">
          <Lock size={24} className="text-amber-600 dark:text-amber-400" />
        </div>
        <h2 className="text-xl font-bold text-gray-900 dark:text-slate-100 mb-2">
          {t("Upgrade required")}
        </h2>
        <p className="text-sm text-gray-600 dark:text-slate-300 mb-1">
          {tx("The {{feature}} feature is not included in your current plan.", {
            feature: <span className="font-semibold">{feature}</span>,
          })}
        </p>
        <p className="text-xs text-gray-400 mb-4">
          {tx("You're on {{plan}}. Available on {{requires}}.", {
            plan: (
              <span className="font-semibold text-gray-700 dark:text-slate-200">
                {plan?.name || "—"}
              </span>
            ),
            requires,
          })}
        </p>
        <div className="bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-left text-sm text-amber-900 dark:text-amber-200 mb-4 flex items-start gap-2">
          <Sparkles size={16} className="text-amber-500 shrink-0 mt-0.5" />
          <span>{t("Contact your platform administrator to upgrade your subscription.")}</span>
        </div>
        <Link to="/settings" className="btn-primary w-full justify-center">
          {t("View my plan")}
        </Link>
      </div>
    </div>
  );
}
