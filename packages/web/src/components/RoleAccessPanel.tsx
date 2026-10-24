// "Who can open what": the Boss's checklist of the pages each role can open, on
// the Users page. A role's row opens into the pages with two ticks each: Open
// (it can see the page) and Edit (it can also make changes there). What is not
// ticked is closed to that role, in the app and on the server alike. Every role
// but the Boss can be changed, and the Boss can make up roles of their own.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Lock, Plus, Trash2 } from "lucide-react";
import { roleLabel } from "@rice-mill/shared";
import {
  roleAccessService,
  type AccessLevel,
  type CustomRoleEntry,
  type RoleAccessData,
  type RoleAccessEntry,
} from "../services/RoleAccessService";
import { NAV_GROUPS } from "./layout/navigation";
import Select from "./Select";

export const ROLE_ACCESS_QUERY_KEY = ["role-access"];
const errorText = (e: any, fallback: string) => e?.response?.data?.detail || fallback;

/** Pages the sidebar doesn't list on its own. */
const EXTRA: Record<string, { label: string; also: string[] }> = {
  settings: {
    label: "Settings",
    also: ["Billing, company, branches, activity log. Everyone keeps their own account."],
  },
};

/** What a page is called, and the other pages that open with it (Maintenance goes
 *  with Milling, Collections and Cash count with Sales), as the sidebar has them. */
function describeSection(section: string): { label: string; also: string[] } {
  if (EXTRA[section]) return EXTRA[section];
  const items = NAV_GROUPS.flatMap((g) => g.items).filter((i) => i.section === section);
  return { label: items[0]?.label ?? section, also: items.slice(1).map((i) => i.label) };
}

type Levels = Record<string, AccessLevel>;

const pick = (from: Levels, sections: string[]) =>
  Object.fromEntries(sections.map((s) => [s, from[s] ?? "none"])) as Levels;

function summary(access: Levels, sections: string[]) {
  const opens = sections.filter((s) => (access[s] ?? "none") !== "none").length;
  const edits = sections.filter((s) => access[s] === "full").length;
  return `Opens ${opens} of ${sections.length} pages, and can edit ${edits}.`;
}

/** The pages, each with an Open and an Edit tick. */
function PageChecklist({
  name,
  sections,
  draft,
  onChange,
}: {
  name: string;
  sections: string[];
  draft: Levels;
  onChange: (section: string, level: AccessLevel) => void;
}) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-muted">
          <th className="py-1 font-medium">Page</th>
          <th className="py-1 w-14 text-center font-medium">Open</th>
          <th className="py-1 w-14 text-center font-medium">Edit</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
        {sections.map((section) => {
          const { label, also } = describeSection(section);
          const level = draft[section] ?? "none";
          return (
            <tr key={section}>
              <td className="py-2 pr-2 whitespace-normal">
                <span className="font-medium text-primary">{label}</span>
                {also.length > 0 && (
                  <span className="block text-xs text-secondary">
                    {section === "settings" ? also[0] : `Also ${also.join(", ")}`}
                  </span>
                )}
              </td>
              <td className="py-2 text-center">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-emerald-600"
                  aria-label={`${name} can open ${label}`}
                  checked={level !== "none"}
                  onChange={(e) => onChange(section, e.target.checked ? "view" : "none")}
                />
              </td>
              <td className="py-2 text-center">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-emerald-600 disabled:opacity-40"
                  aria-label={`${name} can edit ${label}`}
                  checked={level === "full"}
                  disabled={level === "none"}
                  onChange={(e) => onChange(section, e.target.checked ? "full" : "view")}
                />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function SaveError({ error }: { error: unknown }) {
  return (
    <p role="alert" className="text-sm font-medium text-rose-600 dark:text-rose-400">
      {errorText(error, "Couldn't save that. Try again.")}
    </p>
  );
}

function RoleRow({ entry, sections }: { entry: RoleAccessEntry; sections: string[] }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => pick(entry.access, sections));

  const save = useMutation({
    mutationFn: () => roleAccessService.update(entry.role, draft),
    onSuccess: (data) => {
      qc.setQueryData(ROLE_ACCESS_QUERY_KEY, data);
      setOpen(false);
    },
  });

  const name = roleLabel(entry.role);
  const dirty = sections.some((s) => draft[s] !== (entry.access[s] ?? "none"));
  const atDefault = sections.every((s) => draft[s] === (entry.defaults[s] ?? "none"));
  const panelId = `role-access-${entry.role}`;

  const toggle = () => {
    if (!open) {
      setDraft(pick(entry.access, sections));
      save.reset();
    }
    setOpen((o) => !o);
  };

  return (
    <li className="py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-primary">{name}</p>
          <p className="text-xs text-secondary">
            {entry.editable ? summary(entry.access, sections) : "Everything, always."}
          </p>
        </div>
        {entry.editable ? (
          <button
            type="button"
            className="btn-secondary !py-1.5 text-sm shrink-0"
            aria-expanded={open}
            aria-controls={panelId}
            aria-label={`${open ? "Close" : "Choose"} what ${name} can open`}
            onClick={toggle}
          >
            Choose pages
            <ChevronDown
              size={16}
              className={`transition-transform ${open ? "rotate-180" : ""}`}
              aria-hidden
            />
          </button>
        ) : (
          <span className="badge-gray inline-flex items-center gap-1 shrink-0">
            <Lock size={12} aria-hidden /> Full access
          </span>
        )}
      </div>

      {open && (
        <div id={panelId} className="mt-3 rounded-xl border border-soft p-3 space-y-3">
          <PageChecklist
            name={name}
            sections={sections}
            draft={draft}
            onChange={(s, l) => setDraft((d) => ({ ...d, [s]: l }))}
          />
          {save.isError && <SaveError error={save.error} />}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              className="btn-ghost text-sm"
              disabled={atDefault}
              onClick={() => setDraft(pick(entry.defaults, sections))}
            >
              Put back to the default
            </button>
            <div className="flex gap-2">
              <button type="button" className="btn-secondary" onClick={toggle}>
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={!dirty || save.isPending}
                onClick={() => save.mutate()}
              >
                {save.isPending ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </li>
  );
}

/** One of the roles the Boss made up: its pages, its name, and deleting it. */
function CustomRoleRow({ role, sections }: { role: CustomRoleEntry; sections: string[] }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(role.name);
  const [draft, setDraft] = useState(() => pick(role.access, sections));

  const done = (data: RoleAccessData) => {
    qc.setQueryData(ROLE_ACCESS_QUERY_KEY, data);
    setOpen(false);
  };
  const save = useMutation({
    mutationFn: () => roleAccessService.updateCustom(role.id, { name, access: draft }),
    onSuccess: done,
  });
  const remove = useMutation({
    mutationFn: () => roleAccessService.deleteCustom(role.id),
    onSuccess: (data) => {
      qc.setQueryData(ROLE_ACCESS_QUERY_KEY, data);
      // The Users page offers this role; it's gone now.
      void qc.invalidateQueries({ queryKey: ["users"] });
    },
  });

  const dirty =
    name.trim() !== role.name || sections.some((s) => draft[s] !== (role.access[s] ?? "none"));
  const panelId = `custom-role-${role.id}`;
  const people = role.people === 1 ? "1 person" : `${role.people} people`;
  const holders =
    role.people === 0
      ? "Nobody has it yet."
      : `${people} ${role.people === 1 ? "has" : "have"} it.`;

  const toggle = () => {
    if (!open) {
      setName(role.name);
      setDraft(pick(role.access, sections));
      save.reset();
      remove.reset();
    }
    setOpen((o) => !o);
  };

  return (
    <li className="py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-primary break-words">{role.name}</p>
          <p className="text-xs text-secondary">
            {summary(role.access, sections)} {holders}
          </p>
        </div>
        <button
          type="button"
          className="btn-secondary !py-1.5 text-sm shrink-0"
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={`${open ? "Close" : "Choose"} what ${role.name} can open`}
          onClick={toggle}
        >
          Choose pages
          <ChevronDown
            size={16}
            className={`transition-transform ${open ? "rotate-180" : ""}`}
            aria-hidden
          />
        </button>
      </div>

      {open && (
        <div id={panelId} className="mt-3 rounded-xl border border-soft p-3 space-y-3">
          <div>
            <label htmlFor={`${panelId}-name`} className="form-label">
              Role name
            </label>
            <input
              id={`${panelId}-name`}
              className="input"
              maxLength={50}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <PageChecklist
            name={role.name}
            sections={sections}
            draft={draft}
            onChange={(s, l) => setDraft((d) => ({ ...d, [s]: l }))}
          />
          {save.isError && <SaveError error={save.error} />}
          {remove.isError && <SaveError error={remove.error} />}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              className="btn-ghost text-sm text-rose-600 dark:text-rose-400"
              disabled={remove.isPending || role.people > 0}
              title={
                role.people > 0 ? `Give the ${people} who have it another role first.` : undefined
              }
              onClick={() => remove.mutate()}
            >
              <Trash2 size={14} aria-hidden /> Delete role
            </button>
            <div className="flex gap-2">
              <button type="button" className="btn-secondary" onClick={toggle}>
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={!dirty || !name.trim() || save.isPending}
                onClick={() => save.mutate()}
              >
                {save.isPending ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
          {role.people > 0 && (
            <p className="text-xs text-secondary">
              {people} {role.people === 1 ? "has" : "have"} this role. To delete it, give them
              another role first.
            </p>
          )}
        </div>
      )}
    </li>
  );
}

/** Making up a role: a name, where to start from, and its pages. */
function NewRoleForm({ data, onDone }: { data: RoleAccessData; onDone: () => void }) {
  const qc = useQueryClient();
  const sections = data.sections;
  const [name, setName] = useState("");
  const [draft, setDraft] = useState<Levels>(() => pick({}, sections));
  const [start, setStart] = useState("");
  const create = useMutation({
    mutationFn: () => roleAccessService.createCustom(name, draft),
    onSuccess: (result) => {
      qc.setQueryData(ROLE_ACCESS_QUERY_KEY, result);
      onDone();
    },
  });

  // Start from nothing, or from a copy of a role that's close to what's wanted.
  const starts = [
    ...data.roles.map((r) => ({ key: `b:${r.role}`, label: roleLabel(r.role), access: r.access })),
    ...data.custom_roles.map((r) => ({ key: `c:${r.id}`, label: r.name, access: r.access })),
  ];

  return (
    <div className="rounded-xl border border-emerald-500/40 p-3 space-y-3">
      <p className="text-sm font-semibold text-primary">New role</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="new-role-name" className="form-label">
            Role name
          </label>
          <input
            id="new-role-name"
            className="input"
            maxLength={50}
            placeholder="e.g. Warehouse Manager"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="new-role-start" className="form-label">
            Start from
          </label>
          <Select
            id="new-role-start"
            value={start}
            onChange={(key) => {
              setStart(key);
              const from = starts.find((s) => s.key === key);
              setDraft(pick(from?.access ?? {}, sections));
            }}
            options={[
              { value: "", label: "No pages" },
              ...starts.map((s) => ({ value: s.key, label: `A copy of ${s.label}` })),
            ]}
          />
        </div>
      </div>
      <PageChecklist
        name={name.trim() || "The new role"}
        sections={sections}
        draft={draft}
        onChange={(s, l) => setDraft((d) => ({ ...d, [s]: l }))}
      />
      {create.isError && <SaveError error={create.error} />}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onDone}>
          Cancel
        </button>
        <button
          type="button"
          className="btn-primary"
          disabled={!name.trim() || create.isPending}
          onClick={() => create.mutate()}
        >
          {create.isPending ? "Adding…" : "Add role"}
        </button>
      </div>
    </div>
  );
}

export default function RoleAccessPanel() {
  // Put away until it is wanted: the Users page is mostly about the people.
  const [shown, setShown] = useState(false);
  const [adding, setAdding] = useState(false);
  const { data, isLoading, isError } = useQuery({
    queryKey: ROLE_ACCESS_QUERY_KEY,
    queryFn: () => roleAccessService.get(),
    enabled: shown,
  });

  return (
    <section aria-label="Who can open what" className="card space-y-3">
      <button
        type="button"
        className="flex w-full items-start justify-between gap-3 text-left"
        aria-expanded={shown}
        onClick={() => setShown((s) => !s)}
      >
        <span>
          <span className="block font-semibold text-gray-900 dark:text-slate-100">
            Who can open what
          </span>
          <span className="block text-sm text-gray-500 dark:text-slate-400">
            Choose the pages each role can open, and whether they can change things there or only
            look. Add roles of your own.
          </span>
        </span>
        <ChevronDown
          size={18}
          className={`mt-1 shrink-0 transition-transform ${shown ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>

      {shown && (
        <>
          <p className="text-xs text-secondary">
            The Boss always has everything. Every other role, the Admin included, can be changed
            page by page. Everyone keeps their own account (profile, password, devices) whatever
            Settings says.
          </p>
          {isLoading && <p className="text-sm text-muted">Loading…</p>}
          {isError && (
            <p role="alert" className="text-sm font-medium text-rose-600 dark:text-rose-400">
              Couldn't load who can open what. Try again in a moment.
            </p>
          )}
          {data && (
            <>
              <ul className="divide-y divide-gray-100 dark:divide-slate-700">
                {data.roles.map((entry) => (
                  <RoleRow key={entry.role} entry={entry} sections={data.sections} />
                ))}
              </ul>

              <div className="space-y-2 border-t border-soft pt-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-primary">Your own roles</p>
                  {!adding && (
                    <button
                      type="button"
                      className="btn-secondary !py-1.5 text-sm"
                      onClick={() => setAdding(true)}
                    >
                      <Plus size={16} aria-hidden /> Add a role
                    </button>
                  )}
                </div>
                {adding && <NewRoleForm data={data} onDone={() => setAdding(false)} />}
                {data.custom_roles.length === 0 && !adding ? (
                  <p className="text-xs text-secondary">
                    None yet. Add one when a job here doesn't match a role above, like a warehouse
                    manager.
                  </p>
                ) : (
                  <ul className="divide-y divide-gray-100 dark:divide-slate-700">
                    {data.custom_roles.map((role) => (
                      <CustomRoleRow key={role.id} role={role} sections={data.sections} />
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
