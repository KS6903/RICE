import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  ChevronDown,
  Clock,
  Factory,
  HandCoins,
  History,
  Info,
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
import Select from "../components/Select";
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

// As many tiles per row as fit, none narrower than 17rem. Sized by the space the
// page actually has, not the window's: the sidebar takes a varying share of it.
const CARD_GRID = "group/grid grid grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] gap-4";

// Tab order. A group gets a tab only once it has recipes; the blurb is the tab's tooltip.
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
    <span className="inline-flex items-start gap-1.5 text-sm text-secondary">
      {ok ? (
        <CheckCircle2
          size={15}
          className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400"
          aria-hidden
        />
      ) : failed ? (
        <XCircle size={15} className="mt-0.5 shrink-0 text-rose-500" aria-hidden />
      ) : (
        <Clock size={15} className="mt-0.5 shrink-0 text-amber-500" aria-hidden />
      )}
      <span>
        {ok ? "Last ran" : failed ? "Failed" : "Running"} {whenLabel(run.started_at)}
        {failed && run.detail && <span className="text-muted"> · {run.detail}</span>}
      </span>
    </span>
  );
}

const TIP_WIDTH = 288;
const TIP_GAP = 8;
const TIP_MARGIN = 8;
const TIP_LEAVE_MS = 150; // long enough to cross the gap between the (i) and the note

type TipPlace = { left: number; width: number; maxHeight: number; top?: number; bottom?: number };

/**
 * A note folded behind an (i): opens on hover, and stays open after a click so it
 * also works by touch and keyboard.
 *
 * The note can be read at leisure. It stays open while the pointer is on it (a
 * short grace period lets the pointer cross the gap from the (i)), its text can
 * be selected and copied, and pressing inside it pins it open so a drag that
 * strays off it doesn't lose the selection. A press elsewhere, Escape, or
 * scrolling the page puts it away.
 *
 * The note is `fixed` and rendered into <body>, never inside the page. Placed in
 * the page it makes the scroll area grow whenever it is tall or near the bottom:
 * a scrollbar appears, the layout shifts, the (i) slips out from under the
 * pointer, the note closes, the scrollbar goes, and it opens again, forever.
 * It opens below the (i) when it fits there and above it when it doesn't.
 */
function InfoTip({
  label,
  tone = "quiet",
  width = TIP_WIDTH,
  children,
}: {
  /** What a screen reader calls the (i). */
  label: string;
  /** "alert" is for the note a reader must not miss. */
  tone?: "quiet" | "alert";
  width?: number;
  children: ReactNode;
}) {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [place, setPlace] = useState<TipPlace | null>(null);
  const leaveTimer = useRef<number>();
  const open = hover || pinned;

  const enter = () => {
    window.clearTimeout(leaveTimer.current);
    setHover(true);
  };
  const leave = () => {
    window.clearTimeout(leaveTimer.current);
    leaveTimer.current = window.setTimeout(() => setHover(false), TIP_LEAVE_MS);
  };
  const close = () => {
    window.clearTimeout(leaveTimer.current);
    setHover(false);
    setPinned(false);
  };
  useEffect(() => () => window.clearTimeout(leaveTimer.current), []);

  // Measure before paint: first off-screen to learn its height, then where it fits.
  useLayoutEffect(() => {
    if (!open) {
      setPlace(null);
      return;
    }
    const trigger = triggerRef.current?.getBoundingClientRect();
    const tip = tipRef.current;
    if (!trigger || !tip) return;
    const fit = Math.min(width, window.innerWidth - 2 * TIP_MARGIN);
    const left = Math.min(Math.max(trigger.left, TIP_MARGIN), window.innerWidth - fit - TIP_MARGIN);
    const below = window.innerHeight - trigger.bottom - TIP_GAP - TIP_MARGIN;
    const above = trigger.top - TIP_GAP - TIP_MARGIN;
    // Below unless it doesn't fit there and there is more room above.
    const down = tip.scrollHeight <= below || below >= above;
    setPlace(
      down
        ? { left, width: fit, maxHeight: below, top: trigger.bottom + TIP_GAP }
        : {
            left,
            width: fit,
            maxHeight: above,
            bottom: window.innerHeight - trigger.top + TIP_GAP,
          },
    );
    // width is a fixed prop of this instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // While open, a press or a scroll anywhere but the (i) and the note puts it away.
  useEffect(() => {
    if (!open) return;
    const outside = (e: Event) => {
      const target = e.target;
      const inside =
        target instanceof Node &&
        (triggerRef.current?.contains(target) || tipRef.current?.contains(target));
      if (!inside) close();
    };
    window.addEventListener("mousedown", outside);
    window.addEventListener("scroll", outside, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("mousedown", outside);
      window.removeEventListener("scroll", outside, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-describedby={open ? id : undefined}
        onClick={() => setPinned((p) => !p)}
        onMouseEnter={enter}
        onMouseLeave={leave}
        // Focus moving onto the note (to select its text) isn't leaving.
        onBlur={(e) => {
          if (!tipRef.current?.contains(e.relatedTarget as Node | null)) setPinned(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") close();
        }}
        className={`-m-1 inline-flex shrink-0 rounded-full p-1 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500 ${
          tone === "alert"
            ? "text-rose-600 hover:text-rose-700 dark:text-rose-400 dark:hover:text-rose-300"
            : "text-muted hover:text-primary"
        }`}
      >
        <Info size={16} aria-hidden />
      </button>
      {open &&
        createPortal(
          <span
            ref={tipRef}
            id={id}
            role="tooltip"
            tabIndex={-1}
            onMouseEnter={enter}
            onMouseLeave={leave}
            onMouseDown={() => setPinned(true)}
            onBlur={(e) => {
              if (!triggerRef.current?.contains(e.relatedTarget as Node | null)) setPinned(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                close();
                triggerRef.current?.focus();
              }
            }}
            className="fixed z-[70] cursor-text select-text overflow-y-auto rounded-xl bg-white p-3 text-sm text-secondary shadow-xl outline-none ring-1 ring-soft dark:bg-slate-900"
            style={place ?? { left: 0, top: 0, width: TIP_WIDTH, visibility: "hidden" }}
          >
            {children}
          </span>,
          document.body,
        )}
    </>
  );
}

/** An on/off switch, its state in words beside it. */
function Switch({
  checked,
  label,
  disabled,
  onChange,
}: {
  checked: boolean;
  label: string;
  disabled: boolean;
  onChange: () => void;
}) {
  return (
    <div className="flex items-center gap-2 shrink-0">
      <span className="text-sm font-semibold text-secondary" aria-hidden>
        {checked ? "On" : "Off"}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={`${label}: ${checked ? "on" : "off"}`}
        disabled={disabled}
        onClick={onChange}
        className={`relative h-7 w-12 rounded-full transition-colors disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500 ${
          checked ? "bg-emerald-600" : "bg-slate-300 dark:bg-slate-600"
        }`}
      >
        {/* Pinned to the left edge: without left-0 an absolute child of a
            button starts from its centre, and the knob lands off the end.
            The 24px knob then sits 2px in from either end of the 48px track. */}
        <span
          className={`absolute left-0 top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ${
            checked ? "translate-x-[22px]" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
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
  // The title's last word, which the (i) is glued to, and everything before it.
  const lastSpace = automation.title.lastIndexOf(" ");
  const titleStart = automation.title.slice(0, lastSpace + 1);
  const titleEnd = automation.title.slice(lastSpace + 1);
  const panelId = `settings-${automation.code}`;

  const toggleRecipient = (id: string) =>
    setRecipients((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    );

  return (
    <article className="card !p-5 flex flex-col gap-4" aria-labelledby={`title-${automation.code}`}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          {/* The (i) is part of the title's own text, glued to its last word: the two
              sit in one no-wrap span, so wherever the title wraps the (i) goes with
              that word and is never left alone on a line below. The AI badge, if
              any, follows. aria-label keeps the heading's name to just the title. */}
          <h3
            id={`title-${automation.code}`}
            aria-label={automation.title}
            className="text-base font-bold text-primary"
          >
            {titleStart}
            <span className="whitespace-nowrap">
              {titleEnd}
              <span className="ml-1.5 inline-block align-middle">
                <InfoTip label={`What ${automation.title} does`}>{automation.description}</InfoTip>
              </span>
            </span>
            {automation.uses_ai && <span className="badge-violet ml-2 align-middle">AI</span>}
          </h3>
        </div>
        <Switch
          checked={enabled}
          label={automation.title}
          disabled={readOnly || save.isPending || (aiOff && !automation.enabled)}
          onChange={() => save.mutate(!automation.enabled)}
        />
      </div>

      {/* Pinned to the bottom, so the footers line up across a row of tiles. While
          a tile is open its neighbours stretch to match, so let go of the bottom
          then, or they'd show a gap. */}
      <div className="mt-auto group-has-[[aria-expanded=true]]/grid:mt-0 flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
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
        <button
          type="button"
          className="btn-ghost -mr-2 shrink-0"
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
      </div>

      {save.isError && (
        <p className="text-sm text-rose-600 dark:text-rose-400" role="alert">
          {errorText(save.error, "Couldn't save. Check the settings and try again.")}
        </p>
      )}

      {open && (
        <div id={panelId} className="space-y-5 pt-4 border-t border-soft">
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
                {automation.default_roles.map(roleLabel).join(" and ")}: {defaultNames.join(", ")}.
              </p>
            )}
          </fieldset>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="btn-ghost -ml-2"
              onClick={() => setShowRuns((s) => !s)}
            >
              <History size={15} />
              {showRuns ? "Hide history" : "History"}
            </button>
            {!readOnly && (
              <div className="ml-auto flex flex-wrap justify-end gap-2">
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
              </div>
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
  // The language and the on/off button each save on their own, the other sent as it
  // stands. Only a change of on/off is recorded as "switched on by".
  const save = useMutation({
    mutationFn: (change: { enabled?: boolean; language?: string }) =>
      automationsService.updateAI({ enabled: ai.enabled, language: ai.language, ...change }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["automations"] }),
  });
  // While a change is saving, show where it's going.
  const pending = save.isPending ? save.variables : undefined;
  const enabled = pending?.enabled ?? ai.enabled;
  const language = pending?.language ?? ai.language;
  const since = ai.changed_at
    ? new Date(ai.changed_at).toLocaleDateString(undefined, {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : null;

  return (
    <section
      aria-label="AI settings"
      className="card space-y-4 border border-violet-200 dark:border-violet-900/50"
    >
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="max-w-prose space-y-2">
          <p className="flex items-center gap-2 font-semibold text-primary">
            {ai.enabled ? "AI is on for your automations." : "AI is off."}
            <InfoTip label="What the AI sends and what it doesn't" tone="alert" width={384}>
              When it's on, the AI recipes below send your mill's figures to Oryza's AI, a
              third-party AI service hosted outside the Philippines, to write their advice: sales,
              purchases, stock, and the names of customers, suppliers and staff. Phone numbers,
              addresses, TINs, government ID numbers and anything typed into notes are never sent.
              Oryza works out every number itself, and each message shows those figures so you can
              check the advice. AI can still be wrong: check before you act.
            </InfoTip>
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
          <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
            <div>
              <label htmlFor="ai-language" className="form-label">
                Write the advice in
              </label>
              <Select
                id="ai-language"
                className="w-72 max-w-full"
                value={language}
                onChange={(next) => save.mutate({ language: next })}
                options={ai.languages}
              />
            </div>
            {/* A button, not a switch. As tall as the field beside it, so the two
                sit on one line. */}
            <button
              type="button"
              className={`${enabled ? "btn-secondary" : "btn-primary"} h-12`}
              disabled={save.isPending}
              onClick={() => save.mutate({ enabled: !ai.enabled })}
            >
              <Sparkles size={15} aria-hidden />
              {enabled ? "Turn AI off" : "Turn AI on"}
            </button>
          </div>
        )}
      </div>
      {save.isError && (
        <p className="text-sm text-rose-600 dark:text-rose-400" role="alert">
          {errorText(save.error, "Couldn't change the AI setting. Try again.")}
        </p>
      )}
    </section>
  );
}

export default function AutomationsPage() {
  const { isReadOnly, role } = useAccess();
  const readOnly = isReadOnly("automations");
  const list = useQuery({ queryKey: ["automations"], queryFn: () => automationsService.list() });
  const recipes = list.data?.recipes ?? [];
  const ai = list.data?.ai;
  const onCount = recipes.filter((r) => r.enabled).length;

  // One tab per group that has recipes. The first is open until another is picked.
  const [tab, setTab] = useState<AutomationGroup | null>(null);
  const tabs = GROUPS.filter((g) => recipes.some((r) => r.group === g.key));
  const current = tabs.find((g) => g.key === tab) ?? tabs[0];

  // Arrow keys, Home and End move between tabs, as a tablist should.
  const onTabKey = (e: KeyboardEvent, index: number) => {
    const last = tabs.length - 1;
    const next =
      e.key === "ArrowRight"
        ? index === last
          ? 0
          : index + 1
        : e.key === "ArrowLeft"
          ? index === 0
            ? last
            : index - 1
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? last
              : null;
    if (next === null) return;
    e.preventDefault();
    setTab(tabs[next].key);
    document.getElementById(`tab-${tabs[next].key}`)?.focus();
  };

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
        <div className={CARD_GRID} aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="card !p-5 space-y-3">
              <div className="skeleton h-6 w-2/3 rounded" />
              <div className="skeleton h-4 w-full rounded" />
              <div className="skeleton h-4 w-1/2 rounded" />
            </div>
          ))}
        </div>
      ) : list.isError ? (
        <div className="card">
          <p className="text-secondary">
            {errorText(list.error, "Automations couldn't load. Try again in a moment.")}
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {/* Above the tabs, so it is on show whichever tab is open. */}
          {ai && <AISettingsCard ai={ai} isOwner={role === "owner"} />}
          {current && (
            <>
              <div
                role="tablist"
                aria-label="Automation groups"
                className="seg max-w-full overflow-x-auto"
              >
                {tabs.map((group, index) => {
                  const Icon = group.icon;
                  const active = group.key === current.key;
                  return (
                    <button
                      key={group.key}
                      id={`tab-${group.key}`}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      aria-controls={`panel-${group.key}`}
                      tabIndex={active ? 0 : -1}
                      title={group.blurb}
                      className={`seg-btn shrink-0 ${active ? "is-active" : ""}`}
                      onClick={() => setTab(group.key)}
                      onKeyDown={(e) => onTabKey(e, index)}
                    >
                      <Icon size={16} aria-hidden />
                      {group.title}
                    </button>
                  );
                })}
              </div>

              <div
                role="tabpanel"
                id={`panel-${current.key}`}
                aria-labelledby={`tab-${current.key}`}
                className="space-y-4"
              >
                <div className={CARD_GRID}>
                  {recipes
                    .filter((r) => r.group === current.key)
                    .map((automation) => (
                      <AutomationCard
                        key={automation.code}
                        automation={automation}
                        readOnly={readOnly}
                        aiOff={Boolean(automation.uses_ai && !ai?.enabled)}
                      />
                    ))}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
