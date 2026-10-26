import { t } from "../i18n";
/**
 * Stands in for a list while its data is on its way, so a page that is only
 * loading never says it is empty. Shaped like a few rows of text; the shimmer
 * stops for people who ask for less motion (see .skeleton in index.css).
 */
export default function LoadingRows({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3 px-4 py-6" aria-busy="true">
      <span className="sr-only">{t("Loading")}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton h-4" style={{ width: `${90 - ((i * 20) % 50)}%` }} />
      ))}
    </div>
  );
}
