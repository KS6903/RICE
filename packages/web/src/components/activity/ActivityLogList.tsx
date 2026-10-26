import { History } from "lucide-react";
import { formatActivity, activityActor, activityTone, type ActivityRow } from "./format";
import { t } from "../../i18n";

const DOT: Record<ReturnType<typeof activityTone>, string> = {
  rose: "bg-rose-500",
  emerald: "bg-emerald-500",
  slate: "bg-slate-400",
};

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return t("just now");
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString();
}

export default function ActivityLogList({
  rows,
  loading,
  emptyText = t("No activity yet."),
}: {
  rows: ActivityRow[];
  loading?: boolean;
  emptyText?: string;
}) {
  if (loading) {
    return <p className="text-sm text-muted py-6 text-center">{t("Loading activity…")}</p>;
  }
  if (rows.length === 0) {
    return (
      <div className="text-center py-10">
        <History size={28} className="mx-auto text-muted mb-2" />
        <p className="text-sm text-muted">{emptyText}</p>
      </div>
    );
  }
  return (
    <ul className="divide-y divide-slate-100 dark:divide-slate-800">
      {rows.map((row) => (
        <li key={row.id} className="flex items-start gap-3 py-2.5">
          <span
            className={`mt-1.5 shrink-0 w-2 h-2 rounded-full ${DOT[activityTone(row.action)]}`}
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-primary">
              <span className="font-semibold">{activityActor(row)}</span>{" "}
              <span className="text-secondary">
                {formatActivity(row).replace(/^[A-Z]/, (c) => c.toLowerCase())}
              </span>
            </p>
            {row.detail && (
              <p className="text-xs text-muted mt-0.5 whitespace-pre-line">{row.detail}</p>
            )}
          </div>
          <time className="shrink-0 text-xs text-muted tabular-nums" title={row.created_at ?? ""}>
            {timeAgo(row.created_at)}
          </time>
        </li>
      ))}
    </ul>
  );
}
