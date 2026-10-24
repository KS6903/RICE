import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { clsx } from "clsx";
import { useAuthStore } from "../stores/authStore";
import { useAccess } from "../hooks/useAccess";
import { planHas } from "../hooks/useFeature";
import type { AppSection } from "@rice-mill/shared";
import {
  ByproductsList,
  ExpenseCategoriesList,
  MachinesList,
  VarietiesList,
} from "../components/catalog/CatalogLists";
import { DriversPanel, TrucksPanel } from "./DispatchPage";
import { FieldOperatorsContent } from "./FieldOperatorsPage";
import EmployeesPage from "./EmployeesPage";
import { FEATURE_PLAN, PLAN_ORDER, type PlanName } from "../components/layout/navigation";

type List = {
  key: string;
  label: string;
  /** What it's for, one line under the tabs. */
  what: string;
  feature: string;
  /** The page whose edit right it needs. */
  section: AppSection;
  render: () => React.ReactNode;
};

/** Every list the Boss fills in, in the order a mill works. */
const LISTS: List[] = [
  {
    key: "varieties",
    label: "Rice varieties",
    what: "The varieties and grades you buy, mill and sell. Hide one you no longer handle.",
    feature: "paddy",
    section: "paddy",
    render: () => <VarietiesList />,
  },
  {
    key: "byproducts",
    label: "By-products",
    what: "Ipa, darak, binlid and the others you buy, keep or sell.",
    feature: "paddy",
    section: "paddy",
    render: () => <ByproductsList />,
  },
  {
    key: "categories",
    label: "Expense categories",
    what: "What the mill spends on, as the Expenses page groups it.",
    feature: "expenses",
    section: "expenses",
    render: () => <ExpenseCategoriesList />,
  },
  {
    key: "machines",
    label: "Machines",
    what: "Hullers, polishers and dryers, picked on each milling batch.",
    feature: "milling",
    section: "milling",
    render: () => <MachinesList />,
  },
  {
    key: "fleet",
    label: "Trucks & drivers",
    what: "Who delivers, and in what, picked on the Dispatch page.",
    feature: "dispatch",
    section: "dispatch",
    render: () => (
      <div className="space-y-6">
        <TrucksPanel />
        <DriversPanel />
      </div>
    ),
  },
  {
    key: "operators",
    label: "Agents, millers & suppliers",
    what: "The people you deal with in the field.",
    feature: "field_operators",
    section: "operators",
    render: () => <FieldOperatorsContent />,
  },
  {
    key: "employees",
    label: "Employees",
    what: "Your staff records: positions, branches and pay.",
    feature: "employees",
    section: "employees",
    render: () => <EmployeesPage />,
  },
];

/**
 * Stock > Catalog: the lists the Boss fills in once and the rest of the app
 * picks from, in one place. Each list shows when the mill's plan has it and the
 * person can edit its page; lists from other plans wait under one closed line,
 * by plan, as in the menu.
 */
export default function CatalogPage() {
  const user = useAuthStore((s) => s.user);
  const { canEdit, role } = useAccess();
  const mine = LISTS.filter((l) => planHas(user, l.feature) && canEdit(l.section));
  const others = LISTS.filter((l) => !planHas(user, l.feature));
  const [tab, setTab] = useState(mine[0]?.key ?? "");
  const [showOthers, setShowOthers] = useState(false);
  const current = mine.find((l) => l.key === tab) ?? mine[0];
  const canChangePlan = role === "owner" || role === "admin";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-primary">Catalog</h1>
        <p className="text-secondary mt-1 max-w-2xl">
          The lists you fill in once and every page picks from: varieties, by-products,
          categories, machines, trucks, the people you deal with.
        </p>
      </div>

      {mine.length === 0 ? (
        <p className="card text-sm text-secondary">
          Your role can't change any of these lists. The Boss can open them to it.
        </p>
      ) : (
        <>
          <div role="tablist" aria-label="Lists" className="flex flex-wrap gap-2">
            {mine.map((l) => (
              <button
                key={l.key}
                type="button"
                role="tab"
                aria-selected={current?.key === l.key}
                onClick={() => setTab(l.key)}
                className={clsx(
                  "rounded-full px-3.5 py-1.5 text-sm font-semibold ring-1 transition-colors",
                  current?.key === l.key
                    ? "bg-emerald-600 text-white ring-emerald-600"
                    : "text-secondary ring-soft hover:text-primary",
                )}
              >
                {l.label}
              </button>
            ))}
          </div>
          {current && (
            <section role="tabpanel" aria-label={current.label} className="space-y-3">
              <p className="text-sm text-secondary">{current.what}</p>
              {current.render()}
            </section>
          )}
        </>
      )}

      {canChangePlan && others.length > 0 && (
        <section className="border-t border-soft pt-4" data-testid="catalog-other-plans">
          <button
            type="button"
            aria-expanded={showOthers}
            onClick={() => setShowOthers((o) => !o)}
            className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.1em] text-muted hover:text-secondary"
          >
            More with other plans
            <ChevronDown
              size={14}
              aria-hidden
              className={clsx("transition-transform", showOthers && "rotate-180")}
            />
          </button>
          {showOthers && (
            <div className="mt-3 grid gap-4 sm:grid-cols-3">
              {PLAN_ORDER.map((plan: PlanName) => {
                const lists = others.filter(
                  (l) => (FEATURE_PLAN[l.feature] ?? "Enterprise") === plan,
                );
                if (lists.length === 0) return null;
                return (
                  <div key={plan} data-plan={plan}>
                    <p className="text-xs font-semibold text-muted">{plan}</p>
                    <ul className="mt-1 space-y-1 text-sm text-secondary">
                      {lists.map((l) => (
                        <li key={l.key}>
                          <span className="font-medium text-primary/70">{l.label}</span>: {l.what}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
