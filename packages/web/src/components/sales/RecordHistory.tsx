import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { History } from "lucide-react";
import RecordDialog from "./RecordDialog";
import { salesService, type RecordKind } from "../../services/SalesService";

const KIND_NAME: Record<RecordKind, string> = {
  sales_order: "order",
  invoice: "invoice",
  customer: "customer",
};

/** Every logged change to one order, invoice or customer: who, when, and each
 *  field from its old value to its new one. */
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
    queryFn: () => salesService.history(kind, id),
    staleTime: 0,
  });
  return (
    <RecordDialog
      title={`History of ${label}`}
      subtitle={`Every change made to this ${KIND_NAME[kind]}, newest first.`}
      onClose={onClose}
      testId="record-history"
    >
      {q.isLoading && <p className="text-sm text-muted">Loading…</p>}
      {q.isError && <p className="text-sm text-rose-600">Couldn't load the history. Try again.</p>}
      {q.data && q.data.length === 0 && (
        <div className="py-6 text-center">
          <History size={22} className="mx-auto text-muted" aria-hidden />
          <p className="mt-2 text-sm text-secondary">
            No changes yet. Edits to this {KIND_NAME[kind]} show here, field by field.
          </p>
        </div>
      )}
      {q.data && q.data.length > 0 && (
        <ol className="space-y-4">
          {q.data.map((entry) => (
            <li key={entry.id} className="rounded-xl bg-slate-500/5 px-4 py-3">
              <p className="text-xs font-semibold text-secondary">
                {entry.user_name || "System"}
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
