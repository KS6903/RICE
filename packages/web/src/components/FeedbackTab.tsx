import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { CheckCircle2, Star } from "lucide-react";
import { feedbackService } from "../services/FeedbackService";
import { OTHER_REASON, ratingWords, reasonsFor, reasonText } from "../utils/feedbackReasons";
import { t } from "../i18n";

function errorText(error: unknown, fallback: string): string {
  const detail = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  return typeof detail === "string" ? detail : fallback;
}

/** Settings > Feedback: rate the app and pick why, or say why under Other. */
export default function FeedbackTab() {
  const qc = useQueryClient();
  const [rating, setRating] = useState(0);
  const [reasons, setReasons] = useState<string[]>([]);
  const [other, setOther] = useState("");
  const [sent, setSent] = useState(false);

  const { data: latest } = useQuery({
    queryKey: ["feedback"],
    queryFn: () => feedbackService.latest(),
  });

  const send = useMutation({
    mutationFn: () =>
      feedbackService.send({
        rating,
        reasons,
        other_text: reasons.includes(OTHER_REASON) ? other.trim() : null,
      }),
    onSuccess: (saved) => {
      qc.setQueryData(["feedback"], saved);
      setRating(0);
      setReasons([]);
      setOther("");
      setSent(true);
    },
  });

  // Good and bad ratings have different reasons: those that don't fit the new one go.
  const rate = (next: number) => {
    const fits = [...reasonsFor(next), OTHER_REASON];
    setRating(next);
    setReasons((all) => all.filter((r) => fits.includes(r)));
    setSent(false);
  };
  const toggle = (code: string) =>
    setReasons((all) => (all.includes(code) ? all.filter((r) => r !== code) : [...all, code]));

  const wantsOther = reasons.includes(OTHER_REASON);
  const ready = rating > 0 && reasons.length > 0 && (!wantsOther || other.trim() !== "");

  return (
    <div className="space-y-4">
      <section className="card space-y-5" aria-label={t("Feedback")}>
        <div>
          <h3 className="text-lg font-bold text-primary">{t("How is the app working for you?")}</h3>
        </div>

        <div className="space-y-2">
          <div role="radiogroup" aria-label={t("Your rating")} className="flex gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={rating === n}
                aria-label={ratingWords[n]}
                title={ratingWords[n]}
                onClick={() => rate(n)}
                className="rounded-lg p-1 transition-transform hover:scale-110"
              >
                <Star
                  size={32}
                  aria-hidden
                  className={
                    n <= rating
                      ? "fill-amber-400 text-amber-400"
                      : "text-slate-300 dark:text-slate-600"
                  }
                />
              </button>
            ))}
          </div>
          {rating > 0 && (
            <p className="text-sm font-semibold text-primary">{ratingWords[rating]}</p>
          )}
        </div>

        {rating > 0 && (
          <fieldset className="space-y-2">
            <legend className="form-label">
              {rating >= 4 ? t("What do you like about it?") : t("What went wrong?")}
            </legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {[...reasonsFor(rating), OTHER_REASON].map((code) => (
                <label
                  key={code}
                  className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium text-primary ring-1 ring-soft cursor-pointer has-[:checked]:ring-2 has-[:checked]:ring-emerald-500"
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-emerald-600"
                    checked={reasons.includes(code)}
                    onChange={() => toggle(code)}
                  />
                  {reasonText(code)}
                </label>
              ))}
            </div>
            {wantsOther && (
              <div className="pt-2">
                <label htmlFor="feedback-other" className="form-label">
                  {t("Tell us your reason")}
                </label>
                <textarea
                  id="feedback-other"
                  className="input"
                  rows={3}
                  maxLength={500}
                  value={other}
                  onChange={(e) => setOther(e.target.value)}
                />
              </div>
            )}
          </fieldset>
        )}

        {send.isError && (
          <p className="text-sm text-rose-600 dark:text-rose-400" role="alert">
            {errorText(send.error, t("Couldn't send your feedback. Try again."))}
          </p>
        )}
        {sent && (
          <p
            className="flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-400"
            role="status"
          >
            <CheckCircle2 size={16} aria-hidden />
            {t("Thank you. Your feedback was sent.")}
          </p>
        )}
        <button
          type="button"
          className="btn-primary"
          disabled={!ready || send.isPending}
          onClick={() => send.mutate()}
        >
          {send.isPending ? t("Sending…") : t("Send feedback")}
        </button>
      </section>

      {latest && (
        <section className="card space-y-1" aria-label={t("Your last feedback")}>
          <h3 className="text-sm font-bold text-primary">{t("Your last feedback")}</h3>
          <p className="text-sm text-secondary">
            {format(parseISO(latest.created_at), "MMM d, yyyy")}: {ratingWords[latest.rating]}
            {" ("}
            {latest.reasons.map(reasonText).join(", ")}
            {")"}
          </p>
          {latest.other_text && <p className="text-sm text-secondary">"{latest.other_text}"</p>}
        </section>
      )}
    </div>
  );
}
