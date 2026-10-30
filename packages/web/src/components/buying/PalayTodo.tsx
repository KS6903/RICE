// The Palay page's own To do list, for Pro plans and up: the wet palay still
// waiting for its drying to be recorded. A wet line is not finished until then, so
// each one is a thing to do. It's a window of this page only (the button sits in the
// page header), not the overall To do page, which is an Enterprise feature.
import { useState } from "react";
import { ClipboardCheck } from "lucide-react";
import Modal from "../Modal";
import RecordDryingDialog from "./RecordDryingDialog";
import { t } from "../../i18n";

export type PalayTodoItem = { purchase: any; line: any };

/** Every wet line whose drying isn't recorded yet, the oldest purchase first. */
export function wetLinesToRecord(purchases: any[]): PalayTodoItem[] {
  return purchases
    .flatMap((purchase) =>
      (purchase.items ?? [])
        .filter((line: any) => line.is_drying)
        .map((line: any) => ({ purchase, line })),
    )
    .sort((a, b) =>
      String(a.purchase.purchase_date).localeCompare(String(b.purchase.purchase_date)),
    );
}

const kg = (v: unknown) => `${Number(v ?? 0).toLocaleString()} ${t("kg")}`;

export default function PalayTodo({
  purchases,
  canRecord,
}: {
  purchases: any[];
  /** Whoever buys palay can record the drying; others only see what is waiting. */
  canRecord: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [drying, setDrying] = useState<PalayTodoItem | null>(null);
  const todos = wetLinesToRecord(purchases);

  return (
    <>
      <button
        type="button"
        className="btn-secondary shrink-0"
        onClick={() => setOpen(true)}
        data-testid="palay-todo-button"
      >
        <ClipboardCheck size={16} aria-hidden /> {t("To do")}
        {todos.length > 0 && (
          <span
            aria-label={t("{{total}} waiting", { total: todos.length })}
            className="ml-1 min-w-[1.25rem] rounded-full bg-brand-600 px-1.5 text-center text-[11px] font-bold leading-5 text-white"
          >
            {todos.length}
          </span>
        )}
      </button>

      <Modal
        open={open}
        size="lg"
        title={t("To do: Palay")}
        subtitle={t("Wet palay waiting for its drying to be recorded")}
        onClose={() => setOpen(false)}
        testId="palay-todo"
      >
        {todos.length === 0 ? (
          <p className="rounded-xl border border-dashed border-soft p-6 text-center text-sm text-muted">
            {t("Nothing to do. Every wet palay purchase has its drying recorded.")}
          </p>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-slate-700">
            {todos.map(({ purchase, line }) => (
              <li
                key={line.id}
                className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between"
                data-testid="palay-todo-item"
              >
                <div className="min-w-0">
                  <p className="font-mono text-xs text-muted">{purchase.reference_no}</p>
                  <p className="font-semibold text-primary sm:truncate">
                    {[line.variety_code ?? t("Any variety"), line.grade_code]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  <p className="text-xs text-muted sm:truncate">
                    {kg(line.net_weight_kg)}
                    {line.sack_count != null && (
                      <>
                        {" "}
                        ·{" "}
                        {t("{{sacks}} sacks", { sacks: Number(line.sack_count).toLocaleString() })}
                      </>
                    )}
                    {" · "}
                    {purchase.supplier?.name ?? t("No supplier")} · {purchase.purchase_date}
                  </p>
                </div>
                {canRecord && (
                  <button
                    type="button"
                    className="btn-primary sm:shrink-0"
                    onClick={() => setDrying({ purchase, line })}
                  >
                    {t("Record drying")}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Modal>

      {drying && (
        <RecordDryingDialog
          purchase={drying.purchase}
          line={drying.line}
          onClose={() => setDrying(null)}
        />
      )}
    </>
  );
}
