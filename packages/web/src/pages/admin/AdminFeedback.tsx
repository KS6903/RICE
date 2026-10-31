import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { format, parseISO } from "date-fns";
import { MessageSquare, Star } from "lucide-react";
import Select from "../../components/Select";
import { adminService } from "../../services/AdminService";
import { ratingWords, reasonText } from "../../utils/feedbackReasons";
import { t } from "../../i18n";

function Stars({ rating }: { rating: number }) {
  return (
    <span
      role="img"
      aria-label={ratingWords[rating] ?? String(rating)}
      title={ratingWords[rating]}
      className="inline-flex gap-0.5"
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          size={14}
          aria-hidden
          className={
            n <= rating ? "fill-amber-400 text-amber-400" : "text-slate-300 dark:text-slate-600"
          }
        />
      ))}
    </span>
  );
}

/** BossAdmin's view of what every mill said in Settings > Feedback. */
export default function AdminFeedback() {
  const [rating, setRating] = useState("all");
  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin-feedback", rating],
    queryFn: () => adminService.listFeedback(rating === "all" ? null : Number(rating)),
    placeholderData: (previous) => previous,
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-primary">{t("Feedback")}</h1>

      {isLoading && <div className="card skeleton h-40" aria-busy="true" />}
      {isError && <p className="card text-secondary">{t("Feedback couldn't load. Try again.")}</p>}

      {data && (
        <>
          <section aria-label={t("Summary")} className="grid gap-4 md:grid-cols-3">
            <div className="card !p-4">
              <p className="text-xs font-semibold text-muted">{t("Average rating")}</p>
              <p className="mt-1 text-3xl font-bold text-primary tabular-nums">
                {data.summary.average == null ? "0" : data.summary.average.toFixed(1)}
              </p>
              <p className="text-sm text-secondary">
                {t("{{count}} responses", { count: data.summary.count })}
              </p>
            </div>
            <div className="card !p-4 space-y-1">
              <p className="text-xs font-semibold text-muted">{t("Ratings")}</p>
              {[5, 4, 3, 2, 1].map((n) => {
                const count = data.summary.by_rating[String(n)] ?? 0;
                const share = data.summary.count ? (count / data.summary.count) * 100 : 0;
                return (
                  <div key={n} className="flex items-center gap-2 text-xs text-secondary">
                    <span className="w-3 tabular-nums">{n}</span>
                    <div className="h-1.5 flex-1 rounded-full bg-slate-200 dark:bg-slate-700">
                      <div
                        className="h-1.5 rounded-full bg-amber-400"
                        style={{ width: `${share}%` }}
                      />
                    </div>
                    <span className="w-6 text-right tabular-nums">{count}</span>
                  </div>
                );
              })}
            </div>
            <div className="card !p-4 space-y-1">
              <p className="text-xs font-semibold text-muted">{t("Top reasons")}</p>
              {data.summary.reasons.slice(0, 5).map((r) => (
                <div key={r.code} className="flex justify-between gap-2 text-sm text-secondary">
                  <span className="min-w-0 truncate">{reasonText(r.code)}</span>
                  <span className="tabular-nums font-semibold text-primary">{r.count}</span>
                </div>
              ))}
            </div>
          </section>

          <div className="max-w-xs">
            <Select
              aria-label={t("Filter by rating")}
              value={rating}
              onChange={setRating}
              options={[
                { value: "all", label: t("All ratings") },
                ...[5, 4, 3, 2, 1].map((n) => ({ value: String(n), label: ratingWords[n] })),
              ]}
            />
          </div>

          {data.items.length === 0 ? (
            <div className="card flex flex-col items-center gap-2 py-10 text-center">
              <MessageSquare size={24} className="text-muted" aria-hidden />
              <p className="text-sm text-secondary">{t("No feedback here yet.")}</p>
            </div>
          ) : (
            <ul className="space-y-3" aria-label={t("Feedback")}>
              {data.items.map((item) => (
                <li key={item.id} className="card !p-4 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="inline-flex flex-wrap items-center gap-2">
                      <Stars rating={item.rating} />
                      <Link to={`/admin/tenants/${item.company_id}`} className="link font-medium">
                        {item.company_name}
                      </Link>
                      {item.user_name && (
                        <span className="text-sm text-secondary">{item.user_name}</span>
                      )}
                    </span>
                    <time className="text-xs text-muted" dateTime={item.created_at}>
                      {format(parseISO(item.created_at), "MMM d, yyyy h:mm a")}
                    </time>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {item.reasons.map((code) => (
                      <span key={code} className="badge-gray">
                        {reasonText(code)}
                      </span>
                    ))}
                  </div>
                  {item.other_text && (
                    <p className="whitespace-pre-wrap break-words text-sm text-primary">
                      "{item.other_text}"
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
