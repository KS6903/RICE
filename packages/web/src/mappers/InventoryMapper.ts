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

export class InventoryMapper {
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
