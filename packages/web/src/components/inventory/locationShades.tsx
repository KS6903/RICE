// When "All warehouses" adds one variety up across several warehouses, every
// warehouse gets its own shade of the card's colour: amber for palay, emerald
// for milled rice, slate for by-products. The main branch gets the card's own
// colour; the others get lighter and darker shades of it. The shade belongs to
// the warehouse, not to its place in one item's list, so a warehouse looks the
// same on every card, bin row, spreadsheet cell and in the detail window.
//
// Each colour has 100 shades, ordered so the first ones are the easiest to tell
// apart: each next shade is the one whose closest already-picked shade is
// furthest away (measured in OKLab, where distance tracks how different colours
// look). Two or three warehouses get clearly different shades; forty still get
// forty distinct ones.
import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { ItemLocation, UnifiedItem } from "../../mappers/InventoryMapper";
import { t } from "../../i18n";

/** What the split views need from an item (the detail window passes its own shape). */
type SplitItem = Pick<UnifiedItem, "type" | "quantity_kg" | "locations">;
type Kind = UnifiedItem["type"];

/* ── Palette ───────────────────────────────────────────────────────────── */

type Lab = [number, number, number];

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

function rgbToOklab([r, g, b]: [number, number, number]): Lab {
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

const dist = (a: Lab, b: Lab) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// Each card's own colour (Tailwind amber-500, emerald-500, slate-500), as HSL.
const BASE: Record<Kind, { h: number; s: number; l: number }> = {
  palay: { h: 38, s: 0.92, l: 0.5 },
  milled: { h: 160, s: 0.84, l: 0.39 },
  byproduct: { h: 215, s: 0.16, l: 0.47 },
};
// Not so dark or light that a shade disappears against the bar's track, in
// either theme.
const L_MIN = 0.22;
const L_MAX = 0.8;
const SHADE_COUNT = 100;

type Shade = { css: string; lab: Lab };
const shade = (h: number, s: number, l: number): Shade => ({
  css: `hsl(${h} ${Math.round(s * 100)}% ${(l * 100).toFixed(1)}%)`,
  lab: rgbToOklab(hslToRgb(h, s, l)),
});

function buildShades(kind: Kind): Shade[] {
  const { h, s, l } = BASE[kind];
  // 100 lightness steps of the one hue; the step nearest the card's colour is
  // the card's colour itself, and it goes first.
  const steps = Array.from(
    { length: SHADE_COUNT },
    (_, i) => L_MIN + (i * (L_MAX - L_MIN)) / (SHADE_COUNT - 1),
  );
  const own = steps.reduce(
    (best, x, i) => (Math.abs(x - l) < Math.abs(steps[best] - l) ? i : best),
    0,
  );
  const candidates = steps.filter((_, i) => i !== own).map((x) => shade(h, s, x));
  const picked = [shade(h, s, l)];
  const nearest = candidates.map((c) => dist(c.lab, picked[0].lab));
  while (candidates.length) {
    let best = 0;
    for (let i = 1; i < candidates.length; i++) if (nearest[i] > nearest[best]) best = i;
    const [next] = candidates.splice(best, 1);
    nearest.splice(best, 1);
    picked.push(next);
    for (let i = 0; i < candidates.length; i++)
      nearest[i] = Math.min(nearest[i], dist(candidates[i].lab, next.lab));
  }
  return picked;
}

const SHADES: Record<Kind, Shade[]> = {
  palay: buildShades("palay"),
  milled: buildShades("milled"),
  byproduct: buildShades("byproduct"),
};

/** Each card colour's 100 shades, the card's own colour first, then easiest to tell apart. */
export const WAREHOUSE_SHADES: Record<Kind, readonly string[]> = {
  palay: SHADES.palay.map((c) => c.css),
  milled: SHADES.milled.map((c) => c.css),
  byproduct: SHADES.byproduct.map((c) => c.css),
};

/** How different two shades look (OKLab distance; about 0.05 is plainly different). */
export const shadeDifference = (kind: Kind, i: number, j: number): number =>
  dist(SHADES[kind][i].lab, SHADES[kind][j].lab);

export const warehouseColor = (kind: Kind, index: number): string =>
  WAREHOUSE_SHADES[kind][index % SHADE_COUNT];

/* ── One colour per warehouse, the same everywhere ─────────────────────── */

const ColorIndex = createContext<Map<string, number> | null>(null);
const keyOf = (branchId: string | null) => branchId ?? "";

/** Hands each warehouse its colour: main branch first, then by name, with
 *  "Unassigned" stock after the named warehouses. */
export function WarehouseColorProvider({
  branches,
  children,
}: {
  branches: { id: string; name?: string; is_main_branch?: boolean }[];
  children: ReactNode;
}) {
  const index = useMemo(() => {
    const ordered = [...branches].sort(
      (a, b) =>
        Number(!!b.is_main_branch) - Number(!!a.is_main_branch) ||
        (a.name ?? "").localeCompare(b.name ?? "", undefined, { numeric: true }),
    );
    const m = new Map<string, number>();
    ordered.forEach((b, i) => m.set(b.id, i));
    m.set("", ordered.length);
    return m;
  }, [branches]);
  return <ColorIndex.Provider value={index}>{children}</ColorIndex.Provider>;
}

/** A warehouse's shade of a card colour. Outside a provider (or for a warehouse
 *  the list doesn't know yet) it falls back to the warehouse's place in the item. */
export function useWarehouseColor(): (
  kind: Kind,
  loc: ItemLocation,
  fallbackIndex: number,
) => string {
  const index = useContext(ColorIndex);
  return (kind, loc, fallbackIndex) =>
    warehouseColor(kind, index?.get(keyOf(loc.branchId)) ?? fallbackIndex);
}

/** True when the item adds up stock from more than one warehouse. */
export const isSplit = (item: Pick<UnifiedItem, "locations">): boolean =>
  (item.locations?.length ?? 0) > 1;

/* ── Bar and key ───────────────────────────────────────────────────────── */

/** The bar's fill cut into one segment per warehouse, in that warehouse's colour. */
export function LocationSegments({ item }: { item: SplitItem }) {
  const colorOf = useWarehouseColor();
  return (
    <div className="flex h-full w-full gap-px">
      {(item.locations ?? []).map((l, idx) => (
        <div
          key={l.branchId ?? `none-${idx}`}
          className="h-full"
          style={{
            width: `${item.quantity_kg > 0 ? (l.quantity_kg / item.quantity_kg) * 100 : 0}%`,
            backgroundColor: colorOf(item.type, l, idx),
          }}
          title={`${l.branchName}: ${l.quantity_kg.toLocaleString()} kg`}
        />
      ))}
    </div>
  );
}

/** A warehouse's colour dot. */
export function WarehouseDot({
  color,
  className = "h-2 w-2",
}: {
  color: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={`shrink-0 rounded-full ${className}`}
      style={{ backgroundColor: color }}
    />
  );
}

const KINDS: Kind[] = ["palay", "milled", "byproduct"];

/** A warehouse's shade in each card colour (palay, milled rice, by-products),
 *  as one round swatch: what the page key shows, since a warehouse holds all three. */
function WarehouseSwatch({ colors }: { colors: string[] }) {
  const third = 100 / colors.length;
  return (
    <span
      aria-hidden
      className="h-3 w-3 shrink-0 rounded-full ring-1 ring-black/10 dark:ring-white/10"
      style={{
        background: `conic-gradient(${colors
          .map((c, i) => `${c} ${i * third}% ${(i + 1) * third}%`)
          .join(", ")})`,
      }}
    />
  );
}

/** The key under a split bar: each warehouse, its colour and how much it holds.
 *  Lists the biggest `max` and says how many more there are; `all` lists them all. */
export function LocationKey({
  item,
  max = 3,
  all = false,
  inline = false,
  className = "",
}: {
  item: SplitItem;
  max?: number;
  all?: boolean;
  inline?: boolean;
  className?: string;
}) {
  const colorOf = useWarehouseColor();
  const locations = item.locations ?? [];
  const rows = all ? locations : locations.slice(0, max);
  const hidden = locations.length - rows.length;
  return (
    <ul
      aria-label={t("Stock by warehouse")}
      className={`${inline ? "flex flex-wrap gap-x-3 gap-y-1" : "space-y-1"} ${className}`}
    >
      {rows.map((l, idx) => (
        <li
          key={l.branchId ?? `none-${idx}`}
          className={`flex items-center gap-1.5 text-xs ${inline ? "" : "justify-between"}`}
        >
          <span className="flex min-w-0 items-center gap-1.5 text-secondary">
            <WarehouseDot color={colorOf(item.type, l, idx)} />
            <span className="truncate">{l.branchName}</span>
          </span>
          <span className="shrink-0 font-semibold tabular-nums text-primary">
            {t("{{quantity_kg}} kg", { quantity_kg: l.quantity_kg.toLocaleString() })}
          </span>
        </li>
      ))}
      {hidden > 0 && (
        <li
          className="text-[11px] text-muted"
          title={locations
            .slice(rows.length)
            .map((l) => l.branchName)
            .join(", ")}
        >
          {t("+{{count}} more warehouses, open for the full list", { count: hidden })}
        </li>
      )}
    </ul>
  );
}

/** The colour key for the whole page under "All warehouses": every warehouse
 *  holding stock, in its colour, with its total. Picking one shows just that
 *  warehouse. Only shown once something is actually split between warehouses. */
export function WarehouseLegend({
  items,
  onPick,
}: {
  items: SplitItem[];
  onPick: (branchId: string) => void;
}) {
  const index = useContext(ColorIndex);
  const colorOf = useWarehouseColor();
  const warehouses = useMemo(() => {
    const byBranch = new Map<string, ItemLocation>();
    for (const i of items)
      for (const l of i.locations ?? []) {
        const k = keyOf(l.branchId);
        const seen = byBranch.get(k);
        if (seen) seen.quantity_kg += l.quantity_kg;
        else byBranch.set(k, { ...l });
      }
    const rank = (l: ItemLocation) => index?.get(keyOf(l.branchId)) ?? Number.MAX_SAFE_INTEGER;
    return [...byBranch.values()].sort((a, b) => rank(a) - rank(b));
  }, [items, index]);

  if (!items.some(isSplit) || warehouses.length < 2) return null;
  return (
    <div
      data-testid="warehouse-legend"
      className="flex flex-wrap items-center gap-2 rounded-xl glass px-3 py-2"
    >
      <span className="text-[11px] font-bold uppercase tracking-wide text-muted">
        {t("{{warehousesCount}} warehouses", { warehousesCount: warehouses.length })}
      </span>
      {warehouses.map((w, idx) =>
        w.branchId ? (
          <button
            key={w.branchId}
            type="button"
            onClick={() => onPick(w.branchId!)}
            title={t("Show only {{branchName}}", { branchName: w.branchName })}
            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs ring-1 ring-soft bg-white/60 dark:bg-slate-800/50 hover:bg-white dark:hover:bg-slate-800 transition-colors"
          >
            <WarehouseSwatch colors={KINDS.map((k) => colorOf(k, w, idx))} />
            <span className="font-semibold text-primary">{w.branchName}</span>
            <span className="tabular-nums text-muted">
              {t("{{quantity_kg}} kg", { quantity_kg: w.quantity_kg.toLocaleString() })}
            </span>
          </button>
        ) : (
          <span
            key="unassigned"
            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs ring-1 ring-soft"
          >
            <WarehouseSwatch colors={KINDS.map((k) => colorOf(k, w, idx))} />
            <span className="font-semibold text-primary">{w.branchName}</span>
            <span className="tabular-nums text-muted">
              {t("{{quantity_kg}} kg", { quantity_kg: w.quantity_kg.toLocaleString() })}
            </span>
          </span>
        ),
      )}
    </div>
  );
}
