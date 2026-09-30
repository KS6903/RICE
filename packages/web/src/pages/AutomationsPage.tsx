import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, CheckCircle2, Clock, History, Send, Sunrise, XCircle } from "lucide-react";
import { useAccess } from "../hooks/useAccess";
import {
  automationsService,
  type Automation,
  type AutomationField,
  type AutomationRun,
} from "../services/AutomationsService";

const GROUP_ICON = { reports: Sunrise, watch: BellRing, stock: Clock, receivables: History };

function errorText(error: unknown, fallback: string): string {
  const detail = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  return typeof detail === "string" ? detail : fallback;
}

function roleLabel(role: string | null): string {
  return role ? role.replace("_", " ") : "";
}

function whenLabel(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function RunLine({ run }: { run: AutomationRun }) {
  const ok = run.status === "succeeded";
  const failed = run.status === "failed";
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-secondary">
      {ok ? (
        <CheckCircle2 size={15} className="text-emerald-600 dark:text-emerald-400" aria-hidden />
      ) : failed ? (
        <XCircle size={15} className="text-rose-500" aria-hidden />
      ) : (
        <Clock size={15} className="text-amber-500" aria-hidden />
      )}
      {ok ? "Sent" : failed ? "Failed" : "Running"} {whenLabel(run.started_at)}
      {failed && run.detail && <span className="text-muted"> · {run.detail}</span>}
    </span>
  );
}

function FieldInput({
  field,
  value,
  disabled,
  onChange,
}: {
  field: AutomationField;
  value: string | number | boolean | undefined;
  disabled: boolean;
  onChange: (value: string | boolean) => void;
}) {
  const id = `field-${field.name}`;
  if (field.kind === "bool") {
    return (
      <label htmlFor={id} className="flex items-start gap-3 cursor-pointer">
        <input
          id={id}
          type="checkbox"
          className="mt-1 h-5 w-5 accent-emerald-600"
          checked={Boolean(value)}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span>
          <span className="block text-sm font-semibold text-primary">{field.label}</span>
          {field.help && <span className="block text-xs text-secondary">{field.help}</span>}
        </span>
      </label>
    );
  }
  return (
    <div>
      <label htmlFor={id} className="form-label">
        {field.label}
      </label>
      <input
        id={id}
        type={field.kind === "time" ? "time" : "text"}
        className="input max-w-[10rem]"
        value={String(value ?? "")}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
      {field.help && <p className="text-xs text-secondary mt-1">{field.help}</p>}
    </div>
  );
}

function AutomationCard({ automation, readOnly }: { automation: Automation; readOnly: boolean }) {
  const queryClient = useQueryClient();
  const [enabled, setEnabled] = useState(automation.enabled);
  const [params, setParams] = useState(automation.params);
  const [recipients, setRecipients] = useState<string[]>(automation.recipients);
  const [showRuns, setShowRuns] = useState(false);
  const [testNote, setTestNote] = useState<string | null>(null);

  // Take the server's copy whenever it changes (after a save, or a refetch).
  useEffect(() => {
    setEnabled(automation.enabled);
    setParams(automation.params);
    setRecipients(automation.recipients);
  }, [automation]);

  const dirty = useMemo(
    () =>
      enabled !== automation.enabled ||
      JSON.stringify(params) !== JSON.stringify(automation.params) ||
      JSON.stringify([...recipients].sort()) !== JSON.stringify([...automation.recipients].sort()),
    [enabled, params, recipients, automation],
  );

  const save = useMutation({
    mutationFn: () => automationsService.update(automation.code, { enabled, params, recipients }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["automations"] }),
  });

  const test = useMutation({
    mutationFn: () => automationsService.sendTest(automation.code),
    onSuccess: () =>
      setTestNote(
        params.email
          ? "Sent to you. It's under the bell now, and the email follows within 15 minutes."
          : "Sent to you. It's under the bell now.",
      ),
  });

  const runs = useQuery({
    queryKey: ["automation-runs", automation.code],
    queryFn: () => automationsService.runs(automation.code),
    enabled: showRuns,
  });

  const Icon = GROUP_ICON[automation.group] ?? Sunrise;
  const defaultNames = automation.candidates
    .filter((c) => automation.default_roles.includes(c.role ?? ""))
    .map((c) => c.name);

  const toggleRecipient = (id: string) =>
    setRecipients((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    );

  return (
    <section className="card space-y-5" aria-labelledby={`title-${automation.code}`}>
      <div className="flex items-start gap-4">
        <span className="icon-chip icon-chip-brand shrink-0">
          <Icon size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={`title-${automation.code}`} className="text-lg font-bold text-primary">
            {automation.title}
          </h2>
          <p className="text-sm text-secondary mt-0.5 max-w-prose">{automation.description}</p>
        </div>
        <label className="flex items-center gap-2 shrink-0 cursor-pointer select-none">
          <span className="text-sm font-semibold text-secondary">{enabled ? "On" : "Off"}</span>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label={`${automation.title}: ${enabled ? "on" : "off"}`}
            disabled={readOnly}
            onClick={() => setEnabled((e) => !e)}
            className={`relative h-7 w-12 rounded-full transition-colors disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500 ${
              enabled ? "bg-emerald-600" : "bg-slate-300 dark:bg-slate-600"
            }`}
          >
            {/* Pinned to the left edge: without left-0 an absolute child of a
                button starts from its centre, and the knob lands off the end.
                The 24px knob then sits 2px in from either end of the 48px track. */}
            <span
              className={`absolute left-0 top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ${
                enabled ? "translate-x-[22px]" : "translate-x-0.5"
              }`}
            />
          </button>
        </label>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-4">
          {automation.fields.map((field) => (
            <FieldInput
              key={field.name}
              field={field}
              value={params[field.name]}
              disabled={readOnly}
              onChange={(value) => setParams((p) => ({ ...p, [field.name]: value }))}
            />
          ))}
        </div>

        <fieldset>
          <legend className="form-label">Who receives it</legend>
          {automation.candidates.length === 0 ? (
            <p className="text-sm text-secondary">
              Nobody on your team can receive this yet: it needs access to reports.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {automation.candidates.map((c) => (
                <li key={c.id}>
                  <label className="flex items-center gap-3 cursor-pointer py-1">
                    <input
                      type="checkbox"
                      className="h-5 w-5 accent-emerald-600"
                      checked={recipients.includes(c.id)}
                      disabled={readOnly}
                      onChange={() => toggleRecipient(c.id)}
                    />
                    <span className="text-sm text-primary">{c.name}</span>
                    <span className="text-xs text-muted capitalize">{roleLabel(c.role)}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {recipients.length === 0 && defaultNames.length > 0 && (
            <p className="text-xs text-secondary mt-2">
              Nobody ticked, so it goes to the owner: {defaultNames.join(", ")}.
            </p>
          )}
        </fieldset>
      </div>

      <div className="flex flex-wrap items-center gap-3 pt-4 border-t border-soft">
        <div className="flex-1 min-w-[12rem]">
          {automation.last_run ? (
            <RunLine run={automation.last_run} />
          ) : (
            <span className="text-sm text-secondary">
              {automation.enabled ? "Hasn't run yet." : "Switched off."}
            </span>
          )}
        </div>
        <button type="button" className="btn-ghost" onClick={() => setShowRuns((s) => !s)}>
          <History size={15} />
          {showRuns ? "Hide history" : "History"}
        </button>
        {!readOnly && (
          <>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => test.mutate()}
              disabled={test.isPending}
            >
              <Send size={15} />
              {test.isPending ? "Sending…" : "Send me a test"}
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => save.mutate()}
              disabled={!dirty || save.isPending}
            >
              {save.isPending ? "Saving…" : "Save"}
            </button>
          </>
        )}
      </div>

      {save.isError && (
        <p className="text-sm text-rose-600 dark:text-rose-400" role="alert">
          {errorText(save.error, "Couldn't save. Check the settings and try again.")}
        </p>
      )}
      {save.isSuccess && !dirty && (
        <p className="text-sm text-emerald-700 dark:text-emerald-400" role="status">
          Saved.
        </p>
      )}
      {test.isError && (
        <p className="text-sm text-rose-600 dark:text-rose-400" role="alert">
          {errorText(test.error, "The test couldn't be sent. Try again in a moment.")}
        </p>
      )}
      {testNote && !test.isError && (
        <p className="text-sm text-emerald-700 dark:text-emerald-400" role="status">
          {testNote}
        </p>
      )}

      {showRuns && (
        <div className="rounded-xl bg-[rgb(var(--ink)/0.03)] p-3">
          {runs.isLoading ? (
            <div className="space-y-2" aria-busy="true">
              <div className="skeleton h-5 w-2/3 rounded" />
              <div className="skeleton h-5 w-1/2 rounded" />
            </div>
          ) : (runs.data?.runs.length ?? 0) === 0 ? (
            <p className="text-sm text-secondary">No runs yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {runs.data?.runs.map((run) => (
                <li key={`${run.run_key}-${run.started_at}`}>
                  <RunLine run={run} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

export default function AutomationsPage() {
  const { isReadOnly } = useAccess();
  const readOnly = isReadOnly("automations");
  const list = useQuery({ queryKey: ["automations"], queryFn: () => automationsService.list() });

  return (
    <div className="space-y-6">
      <header>
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-2xl font-bold text-primary">Automations</h1>
          <span className="badge-yellow">Enterprise</span>
        </div>
        <p className="text-secondary mt-1 max-w-2xl">
          Reports and reminders that run by themselves. Each one shows up under the bell, and by
          email if you choose.
        </p>
        {readOnly && (
          <p className="text-sm text-secondary mt-2">
            You can see these, but only an owner or admin can change them.
          </p>
        )}
      </header>

      {list.isLoading ? (
        <div className="card space-y-4" aria-busy="true">
          <div className="skeleton h-6 w-1/3 rounded" />
          <div className="skeleton h-4 w-2/3 rounded" />
          <div className="skeleton h-24 w-full rounded-xl" />
        </div>
      ) : list.isError ? (
        <div className="card">
          <p className="text-secondary">
            {errorText(list.error, "Automations couldn't load. Try again in a moment.")}
          </p>
        </div>
      ) : (
        list.data?.recipes.map((automation) => (
          <AutomationCard key={automation.code} automation={automation} readOnly={readOnly} />
        ))
      )}
    </div>
  );
}
