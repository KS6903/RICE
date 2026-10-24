import { useState } from "react";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { costsService } from "../services/CostsService";
import { millingService } from "../services/MillingService";
import { History, Pencil, Plus, Receipt } from "lucide-react";
import { format } from "date-fns";
import QuickAdd from "../components/QuickAdd";
import EmptyState from "../components/EmptyState";
import LoadingRows from "../components/LoadingRows";
import { useAccess } from "../hooks/useAccess";
import { useFeature } from "../hooks/useFeature";
import { useOpenOnArrival } from "../hooks/useOpenOnArrival";
import Select from "../components/Select";
import DatePicker from "../components/DatePicker";
import CodeValue from "../components/CodeValue";
import EditExpenseDialog from "../components/costs/EditExpenseDialog";
import RecordHistory from "../components/sales/RecordHistory";
import { useCanEditSavedRecords } from "../hooks/useRecordEditor";

export default function CostsPage() {
  const qc = useQueryClient();
  const { canEdit } = useAccess();
  // Correcting a saved expense needs edit power; its history, either that or
  // the right to add expenses.
  const canCorrect = useCanEditSavedRecords();
  const canSeeHistory = canCorrect || canEdit("expenses");
  const [editing, setEditing] = useState<any | null>(null);
  const [historyOf, setHistoryOf] = useState<any | null>(null);
  const [showForm, setShowForm] = useOpenOnArrival();
  useEscapeKey(() => setShowForm(false), showForm);

  const { data: expenses = [], isLoading: expensesLoading } = useQuery({
    queryKey: ["expenses"],
    queryFn: () => costsService.listExpenses(),
  });
  const { data: categories = [] } = useQuery({
    queryKey: ["expense-categories"],
    queryFn: () => costsService.listCategories(),
  });
  // Linking a cost to a milling batch needs milling (Basic and up). Without it,
  // don't ask: the refusal would raise the upgrade banner on this page.
  const hasMilling = useFeature("milling");
  const { data: batches = [] } = useQuery({
    queryKey: ["milling-batches"],
    queryFn: () => millingService.listBatches(),
    enabled: hasMilling,
  });

  const [form, setForm] = useState({
    category_id: "",
    batch_id: "",
    expense_date: format(new Date(), "yyyy-MM-dd"),
    amount: "",
    description: "",
    reference_no: "",
  });

  const createExpense = useMutation({
    mutationFn: (body: typeof form) => costsService.createExpense(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["expenses"] });
      setShowForm(false);
    },
  });

  const totalProduction = expenses
    .filter((e: any) => categories.find((c: any) => c.id === e.category_id)?.is_production_cost)
    .reduce((s: number, e: any) => s + Number(e.amount), 0);
  const totalOverhead = expenses
    .filter((e: any) => !categories.find((c: any) => c.id === e.category_id)?.is_production_cost)
    .reduce((s: number, e: any) => s + Number(e.amount), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-slate-100">Expenses & Costs</h2>
          <p className="text-sm text-gray-500 dark:text-slate-400">
            Track fuel, electricity, labor, maintenance, and more
          </p>
        </div>
        <button onClick={() => setShowForm(!showForm)} className="btn-primary shrink-0">
          <Plus size={16} /> Add Expense
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card">
          <p className="text-sm text-gray-500 dark:text-slate-400">Production Costs</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-slate-100 mt-1">
            ₱{totalProduction.toLocaleString()}
          </p>
        </div>
        <div className="card">
          <p className="text-sm text-gray-500 dark:text-slate-400">Overhead</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-slate-100 mt-1">
            ₱{totalOverhead.toLocaleString()}
          </p>
        </div>
        <div className="card">
          <p className="text-sm text-gray-500 dark:text-slate-400">Total Expenses</p>
          <p className="text-2xl font-bold text-red-600 dark:text-red-400 mt-1">
            ₱{(totalProduction + totalOverhead).toLocaleString()}
          </p>
        </div>
      </div>

      {showForm && (
        <div className="card space-y-4">
          <h3 className="font-semibold text-gray-900 dark:text-slate-100">Add Expense</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <div className="flex items-baseline justify-between mb-1">
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-200">
                  Category
                </label>
                <QuickAdd
                  label="New category"
                  endpoint="/costs/categories"
                  queryKey={["expense-categories"]}
                  fields={[
                    {
                      key: "name",
                      label: "Name",
                      required: true,
                      full: true,
                      placeholder: "e.g. Sack/Packaging",
                    },
                    {
                      key: "is_production_cost",
                      label: "Production cost",
                      type: "checkbox",
                      default: true,
                      placeholder: "Production cost (vs. overhead)",
                    },
                  ]}
                  onCreated={(c) => setForm((f) => ({ ...f, category_id: c.id }))}
                />
              </div>
              <Select
                aria-label="Category"
                placeholder="Select category…"
                value={form.category_id}
                onChange={(v) => setForm((f) => ({ ...f, category_id: v }))}
                options={categories.map((c: any) => ({ value: c.id, label: c.name }))}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-1">
                Date
              </label>
              <DatePicker
                aria-label="Expense date"
                value={form.expense_date}
                onChange={(v) => setForm((f) => ({ ...f, expense_date: v }))}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-1">
                Amount (₱)
              </label>
              <input
                type="number"
                className="input"
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
              />
            </div>
            {hasMilling && (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-1">
                  Milling Batch (optional)
                </label>
                <Select
                  aria-label="Milling batch"
                  value={form.batch_id}
                  onChange={(v) => setForm((f) => ({ ...f, batch_id: v }))}
                  options={[
                    { value: "", label: "Not batch-specific" },
                    ...batches.map((b: any) => ({ value: b.id, label: b.batch_no })),
                  ]}
                />
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-1">
                Description
              </label>
              <input
                className="input"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-1">
                Reference No.
              </label>
              <input
                className="input"
                value={form.reference_no}
                onChange={(e) => setForm((f) => ({ ...f, reference_no: e.target.value }))}
              />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowForm(false)} className="btn-secondary">
              Cancel
            </button>
            <button
              onClick={() => createExpense.mutate(form)}
              className="btn-primary"
              disabled={createExpense.isPending}
            >
              {createExpense.isPending ? "Saving…" : "Save Expense"}
            </button>
          </div>
        </div>
      )}

      <div className="card overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-slate-900/50 border-b border-gray-200 dark:border-slate-700">
            <tr>
              {["Date", "Category", "Batch", "Amount", "Description", ""].map((h) => (
                <th
                  key={h}
                  className="px-4 py-3 text-left font-medium text-gray-600 dark:text-slate-300"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
            {expenses.map((e: any) => (
              <tr key={e.id} className="hover:bg-gray-50 dark:hover:bg-slate-900/50">
                <td className="px-4 py-3">{e.expense_date}</td>
                <td className="px-4 py-3">
                  {categories.find((c: any) => c.id === e.category_id)?.name || "—"}
                </td>
                <td className="px-4 py-3">
                  <CodeValue value={batches.find((b: any) => b.id === e.batch_id)?.batch_no} />
                </td>
                <td className="px-4 py-3 font-medium text-red-600 dark:text-red-400">
                  ₱{Number(e.amount).toLocaleString()}
                </td>
                <td className="px-4 py-3 text-gray-500 dark:text-slate-400">
                  {e.description || "—"}
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-3">
                    {canCorrect && (
                      <button
                        type="button"
                        aria-label={`Edit the expense of ${e.expense_date}`}
                        onClick={() => setEditing(e)}
                        className="text-xs font-semibold inline-flex items-center gap-1 text-secondary hover:text-primary"
                      >
                        <Pencil size={12} aria-hidden />
                        Edit
                      </button>
                    )}
                    {canSeeHistory && (
                      <button
                        type="button"
                        aria-label={`History of the expense of ${e.expense_date}`}
                        onClick={() => setHistoryOf(e)}
                        className="text-xs font-semibold inline-flex items-center gap-1 text-secondary hover:text-primary"
                      >
                        <History size={12} aria-hidden />
                        History
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {expensesLoading ? (
              <tr>
                <td colSpan={6}>
                  <LoadingRows />
                </td>
              </tr>
            ) : (
              expenses.length === 0 && (
                <tr>
                  <td colSpan={6}>
                    <EmptyState
                      icon={Receipt}
                      title="No expenses recorded"
                      action={canEdit("expenses") ? "Add your first expense" : undefined}
                      onAction={() => setShowForm(true)}
                      next={
                        hasMilling
                          ? "Production costs can be linked to a milling batch to see what each batch really cost."
                          : undefined
                      }
                    >
                      Fuel, electricity, labor, repairs: anything the mill pays for. Without them
                      the profit on your dashboard only counts sales.
                    </EmptyState>
                  </td>
                </tr>
              )
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <EditExpenseDialog
          expense={editing}
          categories={categories}
          batches={batches}
          onClose={() => setEditing(null)}
        />
      )}
      {historyOf && (
        <RecordHistory
          kind="expense"
          id={historyOf.id}
          label={`the expense of ${historyOf.expense_date}`}
          onClose={() => setHistoryOf(null)}
        />
      )}
    </div>
  );
}
