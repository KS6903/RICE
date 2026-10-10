// Active employees without the government numbers a Philippine employer reports
// contributions and taxes under. The list is plain data, shown on every plan; the
// monthly reminder is an automation, offered to Enterprise mills only, and switched
// here rather than on the Automations page, beside the people it is about.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, ChevronDown, IdCard } from "lucide-react";
import { useFeature } from "../hooks/useFeature";
import { useAccess } from "../hooks/useAccess";
import { automationsService } from "../services/AutomationsService";

export const GOVERNMENT_IDS = [
  ["sss_no", "SSS"],
  ["philhealth_no", "PhilHealth"],
  ["pagibig_no", "Pag-IBIG"],
  ["tin", "TIN"],
] as const;

type Employee = {
  id: string;
  full_name: string;
  is_active: boolean;
  date_terminated?: string | null;
} & Partial<Record<(typeof GOVERNMENT_IDS)[number][0], string | null>>;

export function missingIds(e: Employee): string[] {
  return GOVERNMENT_IDS.filter(([key]) => !(e[key] ?? "").trim()).map(([, label]) => label);
}

const RECIPE = "government_ids";

function MonthlyReminder() {
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: ["automations"], queryFn: () => automationsService.list() });
  const rule = list.data?.recipes.find((r) => r.code === RECIPE);
  const save = useMutation({
    mutationFn: (enabled: boolean) =>
      automationsService.update(RECIPE, {
        enabled,
        params: rule?.params ?? { email: true },
        recipients: rule?.recipients ?? [],
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["automations"] }),
  });
  if (!rule) return null;
  const on = save.isPending && save.variables !== undefined ? save.variables : rule.enabled;
  return (
    <label className="flex items-start gap-3 cursor-pointer">
      <input
        type="checkbox"
        className="mt-1 h-5 w-5 accent-emerald-600"
        checked={on}
        disabled={save.isPending}
        onChange={(e) => save.mutate(e.target.checked)}
      />
      <span>
        <span className="flex items-center gap-1.5 text-sm font-semibold text-primary">
          <BellRing size={14} aria-hidden /> Remind me on the 1st of each month
        </span>
        <span className="block text-xs text-secondary">
          A notice under the bell, and by email, while anyone is still missing a number.
        </span>
        {save.isError && (
          <span className="block text-xs text-rose-600 dark:text-rose-400" role="alert">
            Couldn't change the reminder. Try again.
          </span>
        )}
      </span>
    </label>
  );
}

export default function GovernmentIdsNotice({
  employees,
  onOpen,
}: {
  employees: Employee[];
  onOpen: (employee: Employee) => void;
}) {
  const [open, setOpen] = useState(false);
  const hasAutomations = useFeature("automations");
  const { canEdit } = useAccess();
  const missing = employees
    .filter((e) => e.is_active && !e.date_terminated)
    .map((e) => ({ employee: e, ids: missingIds(e) }))
    .filter((m) => m.ids.length > 0);
  if (missing.length === 0) return null;

  return (
    <section
      aria-label="Missing government numbers"
      className="card space-y-3 border border-amber-300 dark:border-amber-800/60"
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <p className="flex items-start gap-2 text-sm text-primary">
          <IdCard
            size={16}
            className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400"
            aria-hidden
          />
          <span>
            <strong>
              {missing.length} active {missing.length === 1 ? "employee is" : "employees are"}{" "}
              missing government numbers.
            </strong>{" "}
            You need SSS, PhilHealth, Pag-IBIG and TIN numbers to remit contributions and
            withholding tax.
          </span>
        </p>
        <button
          type="button"
          className="btn-ghost -mr-2"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <ChevronDown
            size={16}
            className={`transition-transform ${open ? "rotate-180" : ""}`}
            aria-hidden
          />
          {open ? "Hide who" : "Show who"}
        </button>
      </div>
      {open && (
        <ul className="space-y-1">
          {missing.map(({ employee, ids }) => (
            <li key={employee.id} className="text-sm">
              <button
                type="button"
                className="font-semibold text-emerald-700 dark:text-emerald-400 hover:underline"
                onClick={() => onOpen(employee)}
              >
                {employee.full_name}
              </button>
              <span className="text-secondary">: no {ids.join(", ")}</span>
            </li>
          ))}
        </ul>
      )}
      {hasAutomations && canEdit("automations") && <MonthlyReminder />}
    </section>
  );
}
