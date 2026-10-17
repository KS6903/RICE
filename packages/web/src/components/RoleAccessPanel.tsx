// "Who can open what": the Boss's checklist of the pages each role can open, on
// the Users page. A role's row opens into the pages with two ticks each: Open
// (it can see the page) and Edit (it can also make changes there). What is not
// ticked is closed to that role, in the app and on the server alike.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Lock } from "lucide-react";
import { roleLabel } from "@rice-mill/shared";
import {
  roleAccessService,
  type AccessLevel,
  type RoleAccessEntry,
} from "../services/RoleAccessService";
import { NAV_GROUPS } from "./layout/navigation";

const QUERY_KEY = ["role-access"];
const errorText = (e: any, fallback: string) => e?.response?.data?.detail || fallback;

/** What a page is called, and the other pages that open with it (Maintenance goes
 *  with Milling, Collections and Cash count with Sales), as the sidebar has them. */
function describeSection(section: string): { label: string; also: string[] } {
  const items = NAV_GROUPS.flatMap((g) => g.items).filter((i) => i.section === section);
  return { label: items[0]?.label ?? section, also: items.slice(1).map((i) => i.label) };
}

const pick = (from: Record<string, AccessLevel>, sections: string[]) =>
  Object.fromEntries(sections.map((s) => [s, from[s] ?? "none"])) as Record<string, AccessLevel>;

function RoleRow({ entry, sections }: { entry: RoleAccessEntry; sections: string[] }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => pick(entry.access, sections));

  const save = useMutation({
    mutationFn: () => roleAccessService.update(entry.role, draft),
    onSuccess: (data) => {
      qc.setQueryData(QUERY_KEY, data);
      setOpen(false);
    },
  });

  const name = roleLabel(entry.role);
  const opens = sections.filter((s) => entry.access[s] !== "none").length;
  const edits = sections.filter((s) => entry.access[s] === "full").length;
  const dirty = sections.some((s) => draft[s] !== (entry.access[s] ?? "none"));
  const atDefault = sections.every((s) => draft[s] === entry.defaults[s]);
  const panelId = `role-access-${entry.role}`;

  const toggle = () => {
    if (!open) {
      setDraft(pick(entry.access, sections));
      save.reset();
    }
    setOpen((o) => !o);
  };
  const setLevel = (section: string, level: AccessLevel) =>
    setDraft((d) => ({ ...d, [section]: level }));

  return (
    <li className="py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-primary">{name}</p>
          <p className="text-xs text-secondary">
            {entry.editable
              ? `Opens ${opens} of ${sections.length} pages, and can edit ${edits}.`
              : "Everything, always."}
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
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="py-1 font-medium">Page</th>
                <th className="py-1 w-16 text-center font-medium">Open</th>
                <th className="py-1 w-16 text-center font-medium">Edit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
              {sections.map((section) => {
                const { label, also } = describeSection(section);
                const level = draft[section];
                return (
                  <tr key={section}>
                    <td className="py-2 pr-2">
                      <span className="font-medium text-primary">{label}</span>
                      {also.length > 0 && (
                        <span className="block text-xs text-secondary">Also {also.join(", ")}</span>
                      )}
                    </td>
                    <td className="py-2 text-center">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-emerald-600"
                        aria-label={`${name} can open ${label}`}
                        checked={level !== "none"}
                        onChange={(e) => setLevel(section, e.target.checked ? "view" : "none")}
                      />
                    </td>
                    <td className="py-2 text-center">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-emerald-600 disabled:opacity-40"
                        aria-label={`${name} can edit ${label}`}
                        checked={level === "full"}
                        disabled={level === "none"}
                        onChange={(e) => setLevel(section, e.target.checked ? "full" : "view")}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {save.isError && (
            <p role="alert" className="text-sm font-medium text-rose-600 dark:text-rose-400">
              {errorText(save.error, "Couldn't save that. Try again.")}
            </p>
          )}
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

export default function RoleAccessPanel() {
  // Put away until it is wanted: the Users page is mostly about the people.
  const [shown, setShown] = useState(false);
  const { data, isLoading, isError } = useQuery({
    queryKey: QUERY_KEY,
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
            look.
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
            The Boss and the Admin always have everything. The Dashboard, To do and Settings are
            open to everyone, and Users is for the Boss and the Admin only.
          </p>
          {isLoading && <p className="text-sm text-muted">Loading…</p>}
          {isError && (
            <p role="alert" className="text-sm font-medium text-rose-600 dark:text-rose-400">
              Couldn't load who can open what. Try again in a moment.
            </p>
          )}
          {data && (
            <ul className="divide-y divide-gray-100 dark:divide-slate-700">
              {data.roles.map((entry) => (
                <RoleRow key={entry.role} entry={entry} sections={data.sections} />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
