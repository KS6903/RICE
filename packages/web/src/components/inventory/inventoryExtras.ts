import { t } from "../../i18n";
// Helpers for the Add Inventory modal's quantity units. Custom units persist
// client-side (localStorage) so they survive reloads without a schema
// migration. Server-persisted concepts (warehouses, varieties, grades,
// by-products) live in the API, not here.

export type QuantityUnit = {
  code: string;
  label: string;
  kgPerUnit: number;
  builtin?: boolean;
};

// Conversions to kilograms. Cavan (50 kg) is the canonical Philippine rice
// sack used across the app; the others are common warehouse units.
export const BUILTIN_UNITS: QuantityUnit[] = [
  { code: "kg", label: t("Kilogram (kg)"), kgPerUnit: 1, builtin: true },
  { code: "cavan", label: t("Cavan (50 kg)"), kgPerUnit: 50, builtin: true },
  { code: "sack", label: t("Sack (25 kg)"), kgPerUnit: 25, builtin: true },
  { code: "ton", label: t("Metric ton (t)"), kgPerUnit: 1000, builtin: true },
];

const UNITS_KEY = "rice-mill-custom-units";

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function loadCustomUnits(): QuantityUnit[] {
  return readJson<QuantityUnit[]>(UNITS_KEY, []);
}

export function allUnits(): QuantityUnit[] {
  return [...BUILTIN_UNITS, ...loadCustomUnits()];
}

export function saveCustomUnit(label: string, kgPerUnit: number): QuantityUnit {
  const code = `custom-${slugify(label)}-${Date.now().toString(36)}`;
  const unit: QuantityUnit = { code, label: label.trim(), kgPerUnit };
  const next = [...loadCustomUnits(), unit];
  localStorage.setItem(UNITS_KEY, JSON.stringify(next));
  return unit;
}

export function slugify(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
