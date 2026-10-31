// Under a sale's lines: says when a price is below what the rice costs to make. The
// server decides what each person hears: the Boss gets the figure, anyone else only
// that the price is too low. It warns; the sale can still be saved.
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { savingsService } from "../../services/SavingsService";
import { peso } from "./money";
import { t } from "../../i18n";

export default function BelowCostWarning({
  lines,
}: {
  lines: {
    item_type?: string;
    byproduct_type?: string | null;
    variety_id?: string | null;
    unit_price_per_kg: string;
  }[];
}) {
  const priced = lines
    .filter((l) => (l.variety_id || l.byproduct_type) && Number(l.unit_price_per_kg) > 0)
    .map((l) => ({
      item_type: l.item_type ?? "milled_rice",
      byproduct_type: l.byproduct_type || null,
      variety_id: l.variety_id || null,
      price: Number(l.unit_price_per_kg),
    }));
  const { data } = useQuery({
    queryKey: ["price-check", priced],
    queryFn: () => savingsService.priceCheck(priced),
    enabled: priced.length > 0,
    staleTime: 60_000,
    retry: false,
  });
  const below = (data ?? []).filter((r) => r.below);
  if (priced.length === 0 || below.length === 0) return null;
  const floor = below.reduce<number | null>(
    (most, r) => (r.floor != null ? Math.max(most ?? 0, r.floor) : most),
    null,
  );
  return (
    <p
      role="status"
      data-testid="below-cost-warning"
      className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300"
    >
      <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
      {floor != null
        ? t("This price is below your break-even of {{price}} per kg.", { price: peso(floor) })
        : t("This price is below the minimum. Ask the Boss before you save it.")}
    </p>
  );
}
