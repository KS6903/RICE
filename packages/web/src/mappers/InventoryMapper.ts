// InventoryMapper — turns the three raw inventory API payloads (palay, milled
// rice, by-products) into one normalized UnifiedItem[] the inventory views
// render. Extracted from InventoryPage's inline useMemo (Phase F) so the
// transform is unit-testable in isolation. Pure: no React, no network.

export type UnifiedItem = {
  id: string;
  type: "palay" | "milled" | "byproduct";
  typeLabel: string;
  variety: string;
  grade: string;
  branchId: string | null;
  branchName: string;
  quantity_kg: number;
  color: string;
};

export const BYPRODUCT_NAMES: Record<string, string> = {
  ipa: "Ipa (Rice Hull)",
  darak: "Darak (Rice Bran)",
  binlid: "Binlid (Broken Rice)",
};

// Just the progress-bar color per type (presentation lives in the page; this is
// the one bit of styling the unified item carries).
const BAR_COLOR: Record<UnifiedItem["type"], string> = {
  palay: "bg-amber-500",
  milled: "bg-emerald-500",
  byproduct: "bg-slate-500",
};

const branchName = (row: { branch?: { name?: string } | null }): string =>
  row.branch?.name || "Unassigned";

// The order a flat list shows the three kinds in.
const TYPE_ORDER: Record<UnifiedItem["type"], number> = { palay: 0, milled: 1, byproduct: 2 };

const NO_GRADE = "—";

/** How the owner can have the inventory ordered, top to bottom. */
export type InventorySort = "grade" | "most" | "least" | "variety";

export const INVENTORY_SORTS: { value: InventorySort; label: string }[] = [
  { value: "grade", label: "Grade, then most stock" },
  { value: "most", label: "Most stock first" },
  { value: "least", label: "Least stock first" },
  { value: "variety", label: "Variety, A to Z" },
];

export const DEFAULT_INVENTORY_SORT: InventorySort = "grade";

export const isInventorySort = (v: unknown): v is InventorySort =>
  INVENTORY_SORTS.some((s) => s.value === v);

/** A before B before C, NFA1 before NFA2, and stock with no grade last. */
function compareGrade(a: string, b: string): number {
  const aNone = !a || a === NO_GRADE;
  const bNone = !b || b === NO_GRADE;
  if (aNone || bNone) return Number(aNone) - Number(bNone);
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

type Sortable = { grade: string; variety: string; quantity_kg: number };

function compareBy(sort: InventorySort, a: Sortable, b: Sortable): number {
  const mostFirst = b.quantity_kg - a.quantity_kg;
  switch (sort) {
    case "most":
      return mostFirst;
    case "least":
      return -mostFirst;
    case "variety":
      return (
        a.variety.localeCompare(b.variety, undefined, { numeric: true, sensitivity: "base" }) ||
        mostFirst
      );
    default:
      return compareGrade(a.grade, b.grade) || mostFirst;
  }
}

export class InventoryMapper {
  /** The order for a flat list that mixes palay, milled rice and by-products:
   *  each kind stays together (grades only mean something within a kind), and
   *  the chosen sort orders the rows inside it. */
  static comparator(sort: InventorySort = DEFAULT_INVENTORY_SORT) {
    return (a: UnifiedItem, b: UnifiedItem): number =>
      TYPE_ORDER[a.type] - TYPE_ORDER[b.type] || compareBy(sort, a, b);
  }

  /** The default order (grade, then the most stock). */
  static compare(a: UnifiedItem, b: UnifiedItem): number {
    return InventoryMapper.comparator()(a, b);
  }

  /** Raw API rows of one kind, in the same order (the Classic view lists these). */
  static sortRows<T extends { quantity_kg: number | string }>(
    rows: T[],
    kind: UnifiedItem["type"],
    sort: InventorySort = DEFAULT_INVENTORY_SORT,
  ): T[] {
    const fields = (r: any): Sortable => ({
      grade:
        kind === "palay"
          ? r.grade?.code || NO_GRADE
          : kind === "milled"
            ? r.grade_name || NO_GRADE
            : NO_GRADE,
      variety:
        kind === "byproduct"
          ? BYPRODUCT_NAMES[r.byproduct_type] || r.byproduct_type || NO_GRADE
          : r.variety?.code || NO_GRADE,
      quantity_kg: Number(r.quantity_kg),
    });
    return [...rows].sort((a, b) => compareBy(sort, fields(a), fields(b)));
  }

  static toUnifiedItems(palay: any[], milled: any[], byproducts: any[]): UnifiedItem[] {
    const out: UnifiedItem[] = [];
    for (const p of palay) {
      out.push({
        id: `palay-${p.id}`,
        type: "palay",
        typeLabel: "Palay (Paddy)",
        variety: p.variety?.code || "—",
        grade: p.grade?.code || "—",
        branchId: p.branch_id,
        branchName: branchName(p),
        quantity_kg: Number(p.quantity_kg),
        color: BAR_COLOR.palay,
      });
    }
    for (const m of milled) {
      out.push({
        id: `milled-${m.id}`,
        type: "milled",
        typeLabel: "Milled Rice (Bigas)",
        variety: m.variety?.code || "—",
        grade: m.grade_name || "—",
        branchId: m.branch_id,
        branchName: branchName(m),
        quantity_kg: Number(m.quantity_kg),
        color: BAR_COLOR.milled,
      });
    }
    for (const b of byproducts) {
      out.push({
        id: `bp-${b.id}`,
        type: "byproduct",
        typeLabel: "By-product",
        variety: BYPRODUCT_NAMES[b.byproduct_type] || b.byproduct_type,
        grade: "—",
        branchId: b.branch_id,
        branchName: branchName(b),
        quantity_kg: Number(b.quantity_kg),
        color: BAR_COLOR.byproduct,
      });
    }
    return out;
  }
}
