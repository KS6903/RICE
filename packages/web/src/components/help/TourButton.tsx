import { CircleHelp } from "lucide-react";
import { useHelpStore } from "../../stores/helpStore";
import { t } from "../../i18n";

/** The "?" in the header: one click starts the walkthrough. */
export default function TourButton() {
  const startTour = useHelpStore((s) => s.startTour);
  return (
    <button
      type="button"
      data-tour="help"
      onClick={startTour}
      aria-label={t("Take the tour")}
      title={t("Take the tour")}
      className="h-9 w-9 grid place-items-center rounded-xl text-secondary hover:text-primary hover:bg-slate-500/10 transition-colors"
    >
      <CircleHelp size={18} />
    </button>
  );
}
