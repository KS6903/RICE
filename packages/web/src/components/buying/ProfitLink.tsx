// A Buy & mill page's way to the Profit calculator, for whoever can open it.
import { Link } from "react-router-dom";
import { Calculator } from "lucide-react";
import { useAccess } from "../../hooks/useAccess";
import { useFeature } from "../../hooks/useFeature";
import { t } from "../../i18n";

export default function ProfitLink() {
  const { canView } = useAccess();
  const hasProfit = useFeature("profit");
  if (!hasProfit || !canView("profit")) return null;
  return (
    <Link to="/profit" className="btn-secondary shrink-0">
      <Calculator size={16} aria-hidden /> {t("Profit calculator")}
    </Link>
  );
}
