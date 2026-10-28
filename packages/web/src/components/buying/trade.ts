// The three Buy & mill pages (palay, rice, by-products) share one layout:
// purchases on the left, sales on the right. What differs per page lives here.
import { byproductLabel } from "../../mappers/byproductNames";
import { t } from "../../i18n";

export type TradeKind = "palay" | "rice" | "byproduct";

/** The sales-order line type each page sells. */
export const SALE_ITEM_TYPE: Record<TradeKind, "palay" | "milled_rice" | "byproduct"> = {
  palay: "palay",
  rice: "milled_rice",
  byproduct: "byproduct",
};

/** "No palay sold yet", "Sell rice", … */
export const GOODS: Record<TradeKind, string> = {
  palay: "palay",
  rice: "rice",
  byproduct: "by-products",
};

export const byproductName = (t: string | null | undefined) => (t ? byproductLabel(t) : "—");

export const gradeLabel = (g: string | null | undefined) =>
  g ? g.charAt(0).toUpperCase() + g.slice(1) : "—";

/** What a sales-order line is, in words: "Dinorado · Graded Rice", "Darak (Rice Bran)". */
export const saleLineName = (line: any) =>
  line.item_type === "byproduct"
    ? byproductName(line.byproduct_type)
    : [
        line.variety_code || line.variety_name || t("Any variety"),
        line.grade_name && gradeLabel(line.grade_name),
      ]
        .filter(Boolean)
        .join(" · ");

/** An order's lines of one kind, and what they come to. */
export function linesOf(order: any, kind: TradeKind) {
  const lines = (order.items ?? []).filter((i: any) => i.item_type === SALE_ITEM_TYPE[kind]);
  return {
    lines,
    kg: lines.reduce((s: number, i: any) => s + Number(i.quantity_kg || 0), 0),
    amount: lines.reduce((s: number, i: any) => s + Number(i.line_total || 0), 0),
    others: (order.items ?? []).length - lines.length,
  };
}

export const STATUS_BADGE: Record<string, string> = {
  draft: "badge-gray",
  received: "badge-yellow",
  confirmed: "badge-yellow",
  delivered: "badge-yellow",
  invoiced: "badge-yellow",
  partial: "badge-yellow",
  completed: "badge-green",
  paid: "badge-green",
  unpaid: "badge-red",
  overdue: "badge-red",
  cancelled: "badge-red",
};
