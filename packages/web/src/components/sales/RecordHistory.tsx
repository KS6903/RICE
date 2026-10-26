import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { History } from "lucide-react";
import RecordDialog from "./RecordDialog";
import { salesService, type ChangeEntry } from "../../services/SalesService";
import { paddyService } from "../../services/PaddyService";
import { costsService } from "../../services/CostsService";
import { millingService } from "../../services/MillingService";
import { t } from "../../i18n";

/** The saved records whose corrections are logged (edit power). */
export type RecordKind =
  | "sales_order"
  | "invoice"
  | "customer"
  | "palay_purchase"
  | "rice_purchase"
  | "byproduct_purchase"
  | "expense"
  | "milling_batch";

/** Each kind in words, and where its history comes from. */
const KINDS: Record<RecordKind, { noun: string; load: (id: string) => Promise<ChangeEntry[]> }> = {
  sales_order: { noun: "order", load: (id) => salesService.history("sales_order", id) },
  invoice: { noun: "invoice", load: (id) => salesService.history("invoice", id) },
  customer: { noun: "customer", load: (id) => salesService.history("customer", id) },
  palay_purchase: { noun: "purchase", load: (id) => paddyService.history("palay_purchase", id) },
  rice_purchase: { noun: "purchase", load: (id) => paddyService.history("rice_purchase", id) },
  byproduct_purchase: {
    noun: "purchase",
    load: (id) => paddyService.history("byproduct_purchase", id),
  },
  expense: { noun: "expense", load: (id) => costsService.history(id) },
  milling_batch: { noun: "batch", load: (id) => millingService.history(id) },
};

/** Every logged change to one saved record: who, when, and each field from its
 *  old value to its new one. */
export default function RecordHistory({
  kind,
  id,
  label,
  onClose,
}: {
  kind: RecordKind;
  id: string;
  label: string;
  onClose: () => void;
}) {
  const q = useQuery({
    queryKey: ["record-history", kind, id],
    queryFn: () => KINDS[kind].load(id),
    staleTime: 0,
  });
  return (
    <RecordDialog
      title={t("History of {{label}}", { label })}
      subtitle={t("Every change made to this {{noun}}, newest first.", { noun: KINDS[kind].noun })}
      onClose={onClose}
      testId="record-history"
    >
      {q.isLoading && <p className="text-sm text-muted">{t("Loading…")}</p>}
      {q.isError && (
        <p className="text-sm text-rose-600">{t("Couldn't load the history. Try again.")}</p>
      )}
      {q.data && q.data.length === 0 && (
        <div className="py-6 text-center">
          <History size={22} className="mx-auto text-muted" aria-hidden />
          <p className="mt-2 text-sm text-secondary">
            {t("No changes yet. Edits to this {{noun}} show here, field by field.", {
              noun: KINDS[kind].noun,
            })}
          </p>
        </div>
      )}
      {q.data && q.data.length > 0 && (
        <ol className="space-y-4">
          {q.data.map((entry) => (
            <li key={entry.id} className="rounded-xl bg-slate-500/5 px-4 py-3">
              <p className="text-xs font-semibold text-secondary">
                {entry.user_name || t("System")}
                {entry.created_at && (
                  <span className="font-normal text-muted">
                    {" · "}
                    {format(new Date(entry.created_at), "MMM d, yyyy h:mm a")}
                  </span>
                )}
              </p>
              {entry.detail && (
                <ul className="mt-1.5 space-y-1 text-sm text-primary">
                  {entry.detail.split("\n").map((line, i) => (
                    <li key={i} className="break-words">
                      {line}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      )}
    </RecordDialog>
  );
}
