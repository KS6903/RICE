// Collections: one place to chase money owed, in four steps. Who to call first,
// what they owe, a reminder ready to send, and what happened. The morning list
// of invoices due, the weekly call list and the reminder drafts all lead here.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Clock, Copy, MessageSquare, Phone } from "lucide-react";
import { useAccess } from "../hooks/useAccess";
import { collectionsService, type Debtor, type Outcome } from "../services/CollectionsService";

const OUTCOMES: { value: Outcome; label: string }[] = [
  { value: "promised", label: "Promised to pay" },
  { value: "called", label: "Called, no promise yet" },
  { value: "no_answer", label: "No answer" },
  { value: "reminder_sent", label: "Sent the reminder" },
  { value: "paid", label: "Paid" },
  { value: "disputed", label: "Disputes the bill" },
];

const php = (n: number) =>
  `₱${n.toLocaleString(undefined, { maximumFractionDigits: 0, minimumFractionDigits: 0 })}`;

const day = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

function errorText(error: unknown, fallback: string): string {
  const detail = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail) && typeof detail[0]?.msg === "string")
    return String(detail[0].msg).replace(/^Value error, /, "");
  return fallback;
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="space-y-2">
      <h3 className="flex items-center gap-2 text-sm font-bold text-primary">
        <span className="grid h-6 w-6 place-items-center rounded-full bg-emerald-600 text-xs text-white">
          {n}
        </span>
        {title}
      </h3>
      <div className="pl-8">{children}</div>
    </section>
  );
}

function DebtorDetail({ debtor, canRecord }: { debtor: Debtor; canRecord: boolean }) {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState(debtor.reminder);
  const [copied, setCopied] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>("promised");
  const [promisedDate, setPromisedDate] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const history = useQuery({
    queryKey: ["collections-history", debtor.customer.id],
    queryFn: () => collectionsService.history(debtor.customer.id),
  });
  const record = useMutation({
    mutationFn: () =>
      collectionsService.record(debtor.customer.id, {
        outcome,
        promised_date: outcome === "promised" ? promisedDate || null : null,
        promised_amount: outcome === "promised" && amount ? Number(amount) : null,
        note,
      }),
    onSuccess: () => {
      setNote("");
      setAmount("");
      setPromisedDate("");
      void queryClient.invalidateQueries({ queryKey: ["collections"] });
      void queryClient.invalidateQueries({
        queryKey: ["collections-history", debtor.customer.id],
      });
    },
  });
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  const phone = debtor.customer.phone?.replace(/[^\d+]/g, "");

  return (
    <div className="card space-y-6" aria-label={`Collecting from ${debtor.customer.name}`}>
      <div>
        <h2 className="text-lg font-bold text-primary">{debtor.customer.name}</h2>
        {debtor.customer.phone && (
          <p className="text-sm text-secondary inline-flex items-center gap-1.5">
            <Phone size={14} aria-hidden />
            {debtor.customer.phone}
          </p>
        )}
      </div>

      <Step n={2} title="What they owe">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-secondary">
              <th className="py-1 font-semibold">Invoice</th>
              <th className="py-1 font-semibold">Due</th>
              <th className="py-1 font-semibold text-right">Balance</th>
            </tr>
          </thead>
          <tbody>
            {debtor.invoices.map((i) => (
              <tr key={i.invoice_no} className="border-t border-soft">
                <td className="py-1.5">{i.invoice_no}</td>
                <td className={`py-1.5 ${i.days_late ? "text-rose-600 dark:text-rose-400" : ""}`}>
                  {day(i.due)}
                  {i.days_late ? `, ${i.days_late} days late` : ""}
                </td>
                <td className="py-1.5 text-right font-semibold">{php(i.balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-xs text-secondary mt-2">
          {debtor.last_paid ? `Last paid ${day(debtor.last_paid)}.` : "No payment on record yet."}
        </p>
      </Step>

      <Step n={3} title="Reminder to send">
        <textarea
          aria-label="Reminder message"
          className="input min-h-[7rem]"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
        <div className="flex flex-wrap gap-2 mt-2">
          <button type="button" className="btn-secondary" onClick={copy}>
            <Copy size={15} aria-hidden />
            {copied ? "Copied" : "Copy"}
          </button>
          {phone && (
            <a className="btn-secondary" href={`sms:${phone}?body=${encodeURIComponent(message)}`}>
              <MessageSquare size={15} aria-hidden />
              Open in Messages
            </a>
          )}
        </div>
        <p className="text-xs text-secondary mt-1">Read it before you send it.</p>
      </Step>

      <Step n={4} title="What happened">
        {canRecord && (
          <div className="space-y-3">
            <fieldset className="flex flex-wrap gap-2">
              <legend className="sr-only">Outcome</legend>
              {OUTCOMES.map((o) => (
                <label
                  key={o.value}
                  className={`seg-btn cursor-pointer ${outcome === o.value ? "is-active" : ""}`}
                >
                  <input
                    type="radio"
                    name={`outcome-${debtor.customer.id}`}
                    className="sr-only"
                    checked={outcome === o.value}
                    onChange={() => setOutcome(o.value)}
                  />
                  {o.label}
                </label>
              ))}
            </fieldset>
            {outcome === "promised" && (
              <div className="flex flex-wrap gap-4">
                <div>
                  <label htmlFor="promised-date" className="form-label">
                    Pay by
                  </label>
                  <input
                    id="promised-date"
                    type="date"
                    className="input w-44"
                    value={promisedDate}
                    onChange={(e) => setPromisedDate(e.target.value)}
                  />
                </div>
                <div>
                  <label htmlFor="promised-amount" className="form-label">
                    How much (optional)
                  </label>
                  <input
                    id="promised-amount"
                    inputMode="decimal"
                    className="input w-40"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
                  />
                </div>
              </div>
            )}
            <div>
              <label htmlFor="follow-up-note" className="form-label">
                Note (optional)
              </label>
              <input
                id="follow-up-note"
                className="input"
                maxLength={500}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
            <button
              type="button"
              className="btn-primary"
              disabled={record.isPending}
              onClick={() => record.mutate()}
            >
              {record.isPending ? "Saving…" : "Save what happened"}
            </button>
            {record.isError && (
              <p className="text-sm text-rose-600 dark:text-rose-400" role="alert">
                {errorText(record.error, "Couldn't save. Try again.")}
              </p>
            )}
          </div>
        )}
        <ul className="mt-4 space-y-1.5" aria-label="Earlier follow-ups">
          {(history.data?.follow_ups ?? []).map((f) => (
            <li key={f.id} className="text-sm">
              <span className="text-muted">
                {new Date(f.created_at).toLocaleDateString(undefined, {
                  day: "numeric",
                  month: "short",
                })}
                :
              </span>{" "}
              <span className="text-primary">{f.summary}</span>
              {f.note && <span className="text-secondary">. {f.note}</span>}
            </li>
          ))}
          {history.data && history.data.follow_ups.length === 0 && (
            <li className="text-sm text-secondary">Nothing recorded yet.</li>
          )}
        </ul>
      </Step>
    </div>
  );
}

export default function CollectionsPage() {
  const { canEdit } = useAccess();
  const list = useQuery({ queryKey: ["collections"], queryFn: () => collectionsService.list() });
  const customers = list.data?.customers ?? [];
  const [picked, setPicked] = useState<string | null>(null);
  const current = customers.find((c) => c.customer.id === picked) ?? customers[0];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-primary">Collections</h1>
        <p className="text-secondary mt-1 max-w-2xl">
          Who to chase for money first, what they owe, a reminder ready to send, and what happened.
          {list.data && ` ${php(list.data.overdue_total)} overdue in all.`}
        </p>
      </header>

      {list.isLoading ? (
        <div className="card skeleton h-48" aria-busy="true" />
      ) : list.isError ? (
        <div className="card">
          <p className="text-secondary">
            {errorText(list.error, "Collections couldn't load. Try again in a moment.")}
          </p>
        </div>
      ) : customers.length === 0 ? (
        <div className="card text-center py-10">
          <p className="font-semibold text-primary">Nobody owes you anything overdue.</p>
          <p className="text-sm text-secondary mt-1">
            Customers show up here when an invoice is overdue or due within a week.
          </p>
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(16rem,22rem)_1fr]">
          <Step n={1} title="Who to call first">
            <ol className="space-y-2">
              {customers.map((d) => {
                const active = current?.customer.id === d.customer.id;
                return (
                  <li key={d.customer.id}>
                    <button
                      type="button"
                      aria-current={active ? "true" : undefined}
                      onClick={() => setPicked(d.customer.id)}
                      className={`w-full text-left card !p-3 transition-colors ${
                        active ? "ring-2 ring-emerald-500" : "hover:bg-[rgb(var(--ink)/0.03)]"
                      }`}
                    >
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="font-semibold text-primary truncate">
                          {d.customer.name}
                        </span>
                        <span className="text-sm font-bold text-primary shrink-0">
                          {php(d.overdue || d.due_soon)}
                        </span>
                      </span>
                      <span className="block text-xs text-secondary mt-0.5">
                        {d.overdue
                          ? `Overdue, oldest ${d.oldest_days_late} days`
                          : "Due within the week"}
                      </span>
                      {d.promise === "broken" && (
                        <span className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-rose-600 dark:text-rose-400">
                          <AlertTriangle size={12} aria-hidden /> Promise not kept
                        </span>
                      )}
                      {d.promise === "waiting" && (
                        <span className="mt-1 inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
                          <Clock size={12} aria-hidden /> {d.last_follow_up}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ol>
          </Step>
          {current && (
            <DebtorDetail key={current.customer.id} debtor={current} canRecord={canEdit("sales")} />
          )}
        </div>
      )}
    </div>
  );
}
