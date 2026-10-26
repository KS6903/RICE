// The names of the by-products a mill handles, for every page that shows one.
// Ipa, darak and binlid are every mill's; the ones its Boss adds on Stock >
// Catalog arrive with useByproductKinds (hooks/useByproductKinds.ts), which
// keeps their names here. Records keep a by-product's code, so a code with no
// name yet reads as itself: "darak_d1" → "Darak d1".
import type { ByproductKind } from "../services/ByproductKindService";
import { t } from "../i18n";

export const BYPRODUCT_NAMES: Record<string, string> = {
  ipa: t("Ipa (Rice Hull)"),
  darak: t("Darak (Rice Bran)"),
  binlid: t("Binlid (Broken Rice)"),
};

const added: Record<string, string> = {};

export type ByproductLabel = (code: string) => string;

export function keepByproductNames(kinds: ByproductKind[]): void {
  for (const k of kinds) if (!k.built_in) added[k.code] = k.name;
}

export function byproductLabel(code: string): string {
  const plain = code.replace(/_/g, " ");
  return added[code] ?? BYPRODUCT_NAMES[code] ?? plain.charAt(0).toUpperCase() + plain.slice(1);
}
