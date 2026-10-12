import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, ClipboardCheck, Hand, UserRound } from "lucide-react";
import { notificationService } from "../services/NotificationService";
import { tasksService, type Task } from "../services/TasksService";
import Select from "../components/Select";

type Tab = "mine" | "all" | "done";

function errorText(error: unknown, fallback: string): string {
  const detail = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  return typeof detail === "string" ? detail : fallback;
}

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Due-time choices, in the browser's (the mill's) local time. */
function dueChoices(now = new Date()): { label: string; iso: string }[] {
  const at = (days: number, hour: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + days);
    d.setHours(hour, 0, 0, 0);
    return d.toISOString();
  };
  const choices = [
    { label: "Tomorrow, 5 pm", iso: at(1, 17) },
    { label: "In 3 days", iso: at(3, 17) },
    { label: "In a week", iso: at(7, 17) },
  ];
  if (now.getHours() < 16) choices.unshift({ label: "Today, 5 pm", iso: at(0, 17) });
  return choices;
}

/** The automation an alert came from, by its kind ("automation.<code>"). */
function sourceOf(kind: string): string | null {
  return kind.startsWith("automation.") ? kind.slice("automation.".length) : null;
}

function NewTaskFromAlert({
  notificationId,
  onDone,
}: {
  notificationId: string;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const notices = useQuery({
    queryKey: ["notifications"],
    queryFn: () => notificationService.list(100),
  });
  const notice = notices.data?.items.find((n) => n.id === notificationId);
  const source = notice ? sourceOf(notice.kind) : null;
  const people = useQuery({
    queryKey: ["task-people", source],
    queryFn: () => tasksService.people(source ?? "manual"),
    enabled: Boolean(source),
  });
  const choices = useMemo(() => dueChoices(), []);
  const [assignee, setAssignee] = useState("");
  const [due, setDue] = useState(choices[0].iso);
  const create = useMutation({
    mutationFn: () =>
      tasksService.fromNotice({
        notification_id: notificationId,
        assignee_id: assignee || null,
        due_at: due,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
      onDone();
    },
  });

  if (notices.isLoading) return <div className="card skeleton h-32" aria-busy="true" />;
  if (!notice || !source) {
    return (
      <div className="card">
        <p className="text-sm text-secondary">
          That alert can't be made into a task: only alerts from your automations can.
        </p>
      </div>
    );
  }
  const options = people.data?.people ?? [];
  return (
    <section aria-label="New task" className="card space-y-4">
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-secondary">
          Make this alert a task
        </p>
        <p className="font-semibold text-primary mt-1">{notice.title}</p>
        {notice.body && (
          <p className="text-sm text-secondary mt-1 whitespace-pre-line line-clamp-4">
            {notice.body}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label htmlFor="task-assignee" className="form-label">
            Who will fix it
          </label>
          <Select
            id="task-assignee"
            className="w-64 max-w-full"
            value={assignee}
            onChange={setAssignee}
            options={[
              { value: "", label: "Me" },
              ...options.map((p) => ({
                value: p.id,
                label: `${p.name}${p.role ? ` (${p.role.replace("_", " ")})` : ""}`,
              })),
            ]}
          />
        </div>
        <div>
          <label htmlFor="task-due" className="form-label">
            By when
          </label>
          <Select
            id="task-due"
            className="w-48"
            value={due}
            onChange={setDue}
            options={choices.map((c) => ({ value: c.iso, label: c.label }))}
          />
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className="btn-primary"
            disabled={create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending ? "Saving…" : "Make it a task"}
          </button>
          <button type="button" className="btn-secondary" onClick={onDone}>
            Cancel
          </button>
        </div>
      </div>
      {create.isError && (
        <p className="text-sm text-rose-600 dark:text-rose-400" role="alert">
          {errorText(create.error, "Couldn't make the task. Try again.")}
        </p>
      )}
    </section>
  );
}

function TaskCard({ task, manager }: { task: Task; manager: boolean }) {
  const queryClient = useQueryClient();
  const [resolving, setResolving] = useState(false);
  const [note, setNote] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [assignee, setAssignee] = useState(task.assignee?.id ?? "");
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["tasks"] });
  const people = useQuery({
    queryKey: ["task-people", task.source],
    queryFn: () => tasksService.people(task.source),
    enabled: assigning,
  });
  const ack = useMutation({
    mutationFn: () => tasksService.acknowledge(task.id),
    onSuccess: refresh,
  });
  const resolve = useMutation({
    mutationFn: () => tasksService.resolve(task.id, note),
    onSuccess: refresh,
  });
  const assign = useMutation({
    mutationFn: () => tasksService.assign(task.id, { assignee_id: assignee }),
    onSuccess: () => {
      setAssigning(false);
      void refresh();
    },
  });
  const error = ack.error ?? resolve.error ?? assign.error;
  const done = task.status === "resolved";

  return (
    <article
      aria-labelledby={`task-${task.id}`}
      className={`card !p-5 space-y-3 ${task.overdue ? "border border-rose-300 dark:border-rose-800/60" : ""}`}
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <h3 id={`task-${task.id}`} className="text-base font-bold text-primary min-w-0">
          {task.title}
        </h3>
        {done ? (
          <span className="badge-green">Resolved</span>
        ) : task.overdue ? (
          <span className="badge-red">Overdue</span>
        ) : task.status === "acknowledged" ? (
          <span className="badge-yellow">In progress</span>
        ) : (
          <span className="badge-gray">To do</span>
        )}
      </div>
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-secondary">
        <span className="inline-flex items-center gap-1.5">
          <UserRound size={14} aria-hidden />
          {task.assignee ? task.assignee.name : "Nobody yet"}
        </span>
        {done ? (
          <span>
            Resolved {task.resolved_at ? when(task.resolved_at) : ""}
            {task.resolved_by ? ` by ${task.resolved_by}` : ""}
          </span>
        ) : (
          <span
            className={
              task.overdue
                ? "inline-flex items-center gap-1.5 text-rose-600 dark:text-rose-400"
                : ""
            }
          >
            {task.overdue && <AlertTriangle size={14} aria-hidden />}
            Due {when(task.due_at)}
          </span>
        )}
      </p>
      {task.body && (
        <p className="text-sm text-secondary whitespace-pre-line line-clamp-6">{task.body}</p>
      )}
      {task.resolution && (
        <p className="text-sm text-primary">
          <span className="font-semibold">What was done:</span> {task.resolution}
        </p>
      )}

      {!done && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {task.link && (
            <Link to={task.link} className="btn-ghost -ml-2">
              Open
            </Link>
          )}
          <div className="ml-auto flex flex-wrap gap-2">
            {manager && (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setAssigning((a) => !a)}
              >
                {task.assignee ? "Reassign" : "Assign"}
              </button>
            )}
            {task.status === "open" && (
              <button
                type="button"
                className="btn-secondary"
                disabled={ack.isPending}
                onClick={() => ack.mutate()}
              >
                <Hand size={15} aria-hidden />
                I'm on it
              </button>
            )}
            <button type="button" className="btn-primary" onClick={() => setResolving((r) => !r)}>
              <CheckCircle2 size={15} aria-hidden />
              Mark resolved
            </button>
          </div>
        </div>
      )}

      {assigning && (
        <div className="flex flex-wrap items-end gap-3 pt-3 border-t border-soft">
          <div>
            <label htmlFor={`assign-${task.id}`} className="form-label">
              Give it to
            </label>
            <Select
              id={`assign-${task.id}`}
              className="w-64 max-w-full"
              placeholder="Pick someone"
              value={assignee}
              onChange={setAssignee}
              options={(people.data?.people ?? []).map((p) => ({ value: p.id, label: p.name }))}
            />
          </div>
          <button
            type="button"
            className="btn-primary"
            disabled={!assignee || assign.isPending}
            onClick={() => assign.mutate()}
          >
            Save
          </button>
        </div>
      )}

      {resolving && (
        <div className="space-y-2 pt-3 border-t border-soft">
          <label htmlFor={`note-${task.id}`} className="form-label">
            What was done (optional)
          </label>
          <textarea
            id={`note-${task.id}`}
            className="input min-h-[4.5rem]"
            maxLength={500}
            value={note}
            placeholder="e.g. Called Aling Nena: she pays ₱5,000 on Friday."
            onChange={(e) => setNote(e.target.value)}
          />
          <button
            type="button"
            className="btn-primary"
            disabled={resolve.isPending}
            onClick={() => resolve.mutate()}
          >
            {resolve.isPending ? "Saving…" : "Resolved"}
          </button>
        </div>
      )}

      {error && (
        <p className="text-sm text-rose-600 dark:text-rose-400" role="alert">
          {errorText(error, "Couldn't save. Try again.")}
        </p>
      )}
    </article>
  );
}

export default function TasksPage() {
  const [params, setParams] = useSearchParams();
  const from = params.get("from");
  const [tab, setTab] = useState<Tab>("mine");
  const list = useQuery({
    queryKey: ["tasks", tab],
    queryFn: () => tasksService.list(tab === "all" ? "all" : "mine", tab === "done"),
  });
  const manager = list.data?.manager ?? false;
  const tasks = list.data?.tasks ?? [];
  const tabs: { key: Tab; label: string }[] = [
    { key: "mine", label: "Mine" },
    ...(manager ? [{ key: "all" as Tab, label: "Everyone's" }] : []),
    { key: "done", label: "Done" },
  ];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-primary">To do</h1>
        <p className="text-secondary mt-1 max-w-2xl">
          Alerts someone is fixing: who, by when, and what was done. A task still open after its
          time goes to the owner.
        </p>
      </header>

      {from && <NewTaskFromAlert notificationId={from} onDone={() => setParams({})} />}

      {manager && (list.data?.unassigned ?? 0) > 0 && (
        <p className="text-sm text-amber-700 dark:text-amber-400">
          {list.data?.unassigned} open {list.data?.unassigned === 1 ? "task has" : "tasks have"}{" "}
          nobody on {list.data?.unassigned === 1 ? "it" : "them"} yet. See Everyone's.
        </p>
      )}

      <div role="tablist" aria-label="Which tasks" className="seg max-w-full overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className={`seg-btn shrink-0 ${tab === t.key ? "is-active" : ""}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {list.isLoading ? (
        <div className="space-y-3" aria-busy="true">
          {[0, 1].map((i) => (
            <div key={i} className="card skeleton h-28" />
          ))}
        </div>
      ) : list.isError ? (
        <div className="card">
          <p className="text-secondary">
            {errorText(list.error, "Tasks couldn't load. Try again in a moment.")}
          </p>
        </div>
      ) : tasks.length === 0 ? (
        <div className="card text-center py-10">
          <ClipboardCheck size={28} className="mx-auto text-emerald-600 dark:text-emerald-400" />
          <p className="font-semibold text-primary mt-2">
            {tab === "done" ? "Nothing resolved yet." : "Nothing to do."}
          </p>
          <p className="text-sm text-secondary mt-1 max-w-md mx-auto">
            Tasks come from alerts. Open an alert under the bell and choose "Make it a task", or set
            an automation to track its alerts.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {tasks.map((task) => (
            <TaskCard key={task.id} task={task} manager={manager} />
          ))}
        </div>
      )}
    </div>
  );
}
