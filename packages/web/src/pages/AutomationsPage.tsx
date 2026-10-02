import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  ChevronDown,
  Clock,
  Factory,
  HandCoins,
  History,
  Send,
  ShieldAlert,
  Sparkles,
  Sunrise,
  Truck,
  Users,
  Warehouse,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { useAccess } from "../hooks/useAccess";
import {
  automationsService,
  type AISettings,
  type Automation,
  type AutomationField,
  type AutomationGroup,
  type AutomationRun,
} from "../services/AutomationsService";

type Params = Automation["params"];

// Page order. A group shows only once it has recipes.
const GROUPS: { key: AutomationGroup; title: string; blurb: string; icon: LucideIcon }[] = [
  {
    key: "advisor",
    title: "AI advisor",
    blurb:
      "Advice written by AI from your own figures: what to do today, what to buy, where money leaks.",
    icon: Sparkles,
  },
  {
    key: "reports",
    title: "Reports and summaries",
    blurb: "The numbers you'd ask for, sent on a schedule.",
    icon: Sunrise,
  },
  {
    key: "watch",
    title: "Owner watch",
    blurb: "Entries worth a second look, within 15 minutes of being made.",
    icon: ShieldAlert,
  },
  {
    key: "production",
    title: "Milling and drying",
    blurb: "Batches and palay that need attention.",
    icon: Factory,
  },
  {
    key: "stock",
    title: "Stock and warehouse",
    blurb: "Running low, getting old, or rain on the way.",
    icon: Warehouse,
  },
  {
    key: "receivables",
    title: "Collections and credit",
    blurb: "Who owes you, and who is buying beyond their limit.",
    icon: HandCoins,
  },
  {
    key: "deliveries",
    title: "Deliveries",
    blurb: "Orders that are late or still need a truck.",
    icon: Truck,
  },
  { key: "people", title: "People", blurb: "Your team's paperwork.", icon: Users },
];

const SECTION_NAMES: Record<string, string> = {
  reports: "reports",
  sales: "sales",
  inventory: "inventory",
  milling: "milling",
  paddy: "palay buying",
  dispatch: "dispatch",
  employees: "employees",
  expenses: "expenses",
};

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
      {ok ? "Last ran" : failed ? "Failed" : "Running"} {whenLabel(run.started_at)}
      {failed && run.detail && <span className="text-muted"> · {run.detail}</span>}
    </span>
  );
}

function FieldInput({
  field,
  idPrefix,
  value,
  disabled,
  onChange,
}: {
  field: AutomationField;
  idPrefix: string;
  value: string | number | boolean | undefined;
  disabled: boolean;
  onChange: (value: string | boolean) => void;
}) {
  const id = `${idPrefix}-${field.name}`;
  const help = field.help && <p className="text-xs text-secondary mt-1">{field.help}</p>;

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

  if (field.kind === "select") {
    return (
      <div>
        <label htmlFor={id} className="form-label">
          {field.label}
        </label>
        <select
          id={id}
          className="input max-w-[16rem]"
          value={String(value ?? "")}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        >
          {(field.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {help}
      </div>
    );
  }

  if (field.kind === "time") {
    return (
      <div>
        <label htmlFor={id} className="form-label">
          {field.label}
        </label>
        <input
          id={id}
          type="time"
          className="input max-w-[10rem]"
          value={String(value ?? "")}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
        {help}
      </div>
    );
  }

  // number, money, percent: typed as text so "100,000" can be cleaned up
  // rather than silently rejected by a number input.
  const prefix = field.kind === "money" ? "₱" : null;
  const suffix = field.kind === "percent" ? "%" : field.unit || null;
  return (
    <div>
      <label htmlFor={id} className="form-label">
        {field.label}
      </label>
      <div className="flex items-center gap-2">
        {prefix && <span className="text-secondary font-semibold">{prefix}</span>}
        <input
          id={id}
          type="text"
          inputMode="decimal"
          className="input max-w-[10rem]"
          value={String(value ?? "")}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value.replace(/[,\s₱%]/g, ""))}
        />
        {suffix && <span className="text-sm text-secondary">{suffix}</span>}
      </div>
      {help}
    </div>
  );
}

function AutomationCard({
  automation,
  readOnly,
  aiOff = false,
}: {
  automation: Automation;
  readOnly: boolean;
  /** An AI recipe while the mill's AI switch is off: it can't be switched on. */
  aiOff?: boolean;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [params, setParams] = useState<Params>(automation.params);
  const [recipients, setRecipients] = useState<string[]>(automation.recipients);
  const [showRuns, setShowRuns] = useState(false);
  const [testNote, setTestNote] = useState<string | null>(null);

  // Take the server's copy whenever it changes (after a save, or a refetch).
  useEffect(() => {
    setParams(automation.params);
    setRecipients(automation.recipients);
  }, [automation]);

  const dirty = useMemo(
    () =>
      JSON.stringify(params) !== JSON.stringify(automation.params) ||
      JSON.stringify([...recipients].sort()) !== JSON.stringify([...automation.recipients].sort()),
    [params, recipients, automation],
  );

  const save = useMutation({
    mutationFn: (enabled: boolean) =>
      automationsService.update(automation.code, { enabled, params, recipients }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["automations"] }),
  });

  const test = useMutation({
    mutationFn: () => automationsService.sendTest(automation.code),
    onSuccess: ({ sent }) =>
      setTestNote(
        sent === 0
          ? "Nothing to report right now, so nothing was sent. It will tell you when there is."
          : params.email
            ? "Sent to you. It's under the bell now, and the email follows within 15 minutes."
            : "Sent to you. It's under the bell now.",
      ),
  });

  const runs = useQuery({
    queryKey: ["automation-runs", automation.code],
    queryFn: () => automationsService.runs(automation.code),
    enabled: showRuns,
  });

  // While a switch is saving, show where it's going.
  const enabled =
    save.isPending && save.variables !== undefined ? save.variables : automation.enabled;
  const defaultNames = automation.candidates
    .filter((c) => automation.default_roles.includes(c.role ?? ""))
    .map((c) => c.name);
  const sectionName = SECTION_NAMES[automation.section ?? "reports"] ?? automation.section;
  const panelId = `settings-${automation.code}`;

  const toggleRecipient = (id: string) =>
    setRecipients((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    );

  return (
    <article className="card space-y-4" aria-labelledby={`title-${automation.code}`}>
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 id={`title-${automation.code}`} className="text-base font-bold text-primary">
              {automation.title}
            </h3>
            {automation.uses_ai && <span className="badge-violet">AI</span>}
          </div>
          <p className="text-sm text-secondary mt-0.5 max-w-prose">{automation.description}</p>
          <div className="mt-2">
            {aiOff ? (
              <span className="text-sm text-muted">
                {automation.enabled
                  ? "Paused: AI is switched off."
                  : "Switch on AI above to use this."}
              </span>
            ) : automation.last_run ? (
              <RunLine run={automation.last_run} />
            ) : (
              <span className="text-sm text-muted">
                {automation.enabled ? "Hasn't run yet." : "Off."}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-sm font-semibold text-secondary" aria-hidden>
            {enabled ? "On" : "Off"}
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label={`${automation.title}: ${enabled ? "on" : "off"}`}
            disabled={readOnly || save.isPending || (aiOff && !automation.enabled)}
            onClick={() => save.mutate(!automation.enabled)}
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
        </div>
      </div>

      <button
        type="button"
        className="btn-ghost -ml-2"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
      >
        <ChevronDown
          size={16}
          className={`transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
        {open ? "Hide settings" : "Settings"}
      </button>

      {save.isError && (
        <p className="text-sm text-rose-600 dark:text-rose-400" role="alert">
          {errorText(save.error, "Couldn't save. Check the settings and try again.")}
        </p>
      )}

      {open && (
        <div id={panelId} className="space-y-5 pt-4 border-t border-soft">
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-4">
              {automation.fields.map((field) => (
                <FieldInput
                  key={field.name}
                  field={field}
                  idPrefix={automation.code}
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
                  Nobody on your team can receive this yet: it needs access to {sectionName}.
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
                  Nobody ticked, so it goes to the{" "}
                  {automation.default_roles.map(roleLabel).join(" and ")}: {defaultNames.join(", ")}
                  .
                </p>
              )}
            </fieldset>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="btn-ghost" onClick={() => setShowRuns((s) => !s)}>
              <History size={15} />
              {showRuns ? "Hide history" : "History"}
            </button>
            <span className="flex-1" />
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
                  onClick={() => save.mutate(automation.enabled)}
                  disabled={!dirty || save.isPending}
                >
                  {save.isPending ? "Saving…" : "Save"}
                </button>
              </>
            )}
          </div>

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
        </div>
      )}
    </article>
  );
}

function AISettingsCard({ ai, isOwner }: { ai: AISettings; isOwner: boolean }) {
  const queryClient = useQueryClient();
  const [language, setLanguage] = useState(ai.language);
  useEffect(() => setLanguage(ai.language), [ai.language]);
  const save = useMutation({
    mutationFn: (enabled: boolean) => automationsService.updateAI({ enabled, language }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["automations"] }),
  });
  const since = ai.changed_at
    ? new Date(ai.changed_at).toLocaleDateString(undefined, {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : null;

  return (
    <div className="card space-y-4 border border-violet-200 dark:border-violet-900/50">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="max-w-prose space-y-2">
          <p className="font-semibold text-primary">
            {ai.enabled ? "AI is on for your automations." : "AI is off."}
          </p>
          <p className="text-sm text-secondary">
            When it's on, the AI recipes below send your mill's figures to DeepSeek, an AI service
            outside the Philippines, to write their advice: sales, purchases, stock, and the names
            of customers, suppliers and staff. Phone numbers, addresses, TINs, government ID numbers
            and anything typed into notes are never sent. Oryza works out every number itself, and
            each message shows those figures so you can check the advice. AI can still be wrong:
            check before you act.
          </p>
          {ai.enabled && ai.changed_by && since && (
            <p className="text-xs text-muted">
              Switched on by {ai.changed_by} on {since}.
            </p>
          )}
          {!ai.configured && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              AI isn't set up on this server yet, so these send their figures without the advice.
            </p>
          )}
          {!isOwner && (
            <p className="text-xs text-muted">Only the mill's owner can switch AI on or off.</p>
          )}
        </div>
        {isOwner && (
          <div className="space-y-3 shrink-0">
            <div>
              <label htmlFor="ai-language" className="form-label">
                Write the advice in
              </label>
              <select
                id="ai-language"
                className="input max-w-[16rem]"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
              >
                {ai.languages.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex gap-2 flex-wrap">
              {ai.enabled ? (
                <>
                  {language !== ai.language && (
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={save.isPending}
                      onClick={() => save.mutate(true)}
                    >
                      Save language
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={save.isPending}
                    onClick={() => save.mutate(false)}
                  >
                    Switch AI off
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="btn-primary"
                  disabled={save.isPending}
                  onClick={() => save.mutate(true)}
                >
                  <Sparkles size={15} />I agree, switch AI on
                </button>
              )}
            </div>
          </div>
        )}
      </div>
      {save.isError && (
        <p className="text-sm text-rose-600 dark:text-rose-400" role="alert">
          {errorText(save.error, "Couldn't change the AI setting. Try again.")}
        </p>
      )}
    </div>
  );
}

export default function AutomationsPage() {
  const { isReadOnly, role } = useAccess();
  const readOnly = isReadOnly("automations");
  const list = useQuery({ queryKey: ["automations"], queryFn: () => automationsService.list() });
  const recipes = list.data?.recipes ?? [];
  const ai = list.data?.ai;
  const onCount = recipes.filter((r) => r.enabled).length;

  return (
    <div className="space-y-8">
      <header>
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-2xl font-bold text-primary">Automations</h1>
          <span className="badge-yellow">Enterprise</span>
        </div>
        <p className="text-secondary mt-1 max-w-2xl">
          Reports and alerts that run by themselves. Each one shows up under the bell, and by email
          if you choose.
          {recipes.length > 0 && ` ${onCount} of ${recipes.length} switched on.`}
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
        GROUPS.map((group) => {
          const items = recipes.filter((r) => r.group === group.key);
          if (items.length === 0) return null;
          const Icon = group.icon;
          return (
            <section key={group.key} aria-labelledby={`group-${group.key}`} className="space-y-3">
              <div className="flex items-center gap-3">
                <span className="icon-chip icon-chip-brand shrink-0">
                  <Icon size={18} />
                </span>
                <div>
                  <h2 id={`group-${group.key}`} className="text-lg font-semibold text-primary">
                    {group.title}
                  </h2>
                  <p className="text-sm text-secondary">{group.blurb}</p>
                </div>
              </div>
              {group.key === "advisor" && ai && (
                <AISettingsCard ai={ai} isOwner={role === "owner"} />
              )}
              <div className="grid gap-3">
                {items.map((automation) => (
                  <AutomationCard
                    key={automation.code}
                    automation={automation}
                    readOnly={readOnly}
                    aiOff={Boolean(automation.uses_ai && !ai?.enabled)}
                  />
                ))}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}
