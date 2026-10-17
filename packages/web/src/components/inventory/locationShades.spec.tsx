import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import {
  LocationKey,
  WAREHOUSE_SHADES,
  WarehouseColorProvider,
  WarehouseLegend,
  shadeDifference,
  useWarehouseColor,
} from "./locationShades";
import type { ItemLocation } from "../../mappers/InventoryMapper";

const locs = (n: number): ItemLocation[] =>
  Array.from({ length: n }, (_, i) => ({
    branchId: `b${i + 1}`,
    branchName: `Warehouse ${i + 1}`,
    quantity_kg: (n - i) * 100, // biggest first, as the mapper hands them over
  }));

const KINDS = ["palay", "milled", "byproduct"] as const;
const hueOf = (css: string) => Number(css.match(/^hsl\((\d+)/)![1]);

const minDifference = (kind: (typeof KINDS)[number], n: number) => {
  let min = Infinity;
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) min = Math.min(min, shadeDifference(kind, i, j));
  return min;
};

describe("warehouse shades", () => {
  it("has 100 different shades of each card colour, all the card's own hue", () => {
    for (const kind of KINDS) {
      const shades = WAREHOUSE_SHADES[kind];
      expect(shades).toHaveLength(100);
      expect(new Set(shades).size).toBe(100);
      expect(new Set(shades.map(hueOf)).size).toBe(1);
    }
    expect(hueOf(WAREHOUSE_SHADES.palay[0])).toBe(38); // amber
    expect(hueOf(WAREHOUSE_SHADES.milled[0])).toBe(160); // emerald
    expect(hueOf(WAREHOUSE_SHADES.byproduct[0])).toBe(215); // slate
  });

  it("starts with the card's own colour", () => {
    expect(WAREHOUSE_SHADES.milled[0]).toBe("hsl(160 84% 39.0%)");
    expect(WAREHOUSE_SHADES.palay[0]).toBe("hsl(38 92% 50.0%)");
  });

  it("puts the shades that are easiest to tell apart first", () => {
    for (const kind of KINDS) {
      // A mill with a few warehouses gets plainly different shades...
      expect(minDifference(kind, 3)).toBeGreaterThan(0.1);
      // ...and adding warehouses only ever narrows the gap, never the other way round.
      expect(minDifference(kind, 3)).toBeGreaterThanOrEqual(minDifference(kind, 6));
      expect(minDifference(kind, 6)).toBeGreaterThanOrEqual(minDifference(kind, 20));
      expect(minDifference(kind, 20)).toBeGreaterThanOrEqual(minDifference(kind, 100));
    }
  });

  it("gives a warehouse the same shade wherever it shows up, main branch first", () => {
    const seen: string[] = [];
    function Probe({ loc, idx }: { loc: ItemLocation; idx: number }) {
      seen.push(useWarehouseColor()("milled", loc, idx));
      return null;
    }
    const second = { branchId: "b2", branchName: "2nd", quantity_kg: 1 };
    render(
      <WarehouseColorProvider
        branches={[
          { id: "b2", name: "2nd" },
          { id: "b1", name: "Main", is_main_branch: true },
        ]}
      >
        {/* The same warehouse at a different place in two items */}
        <Probe loc={second} idx={0} />
        <Probe loc={second} idx={3} />
        <Probe loc={{ branchId: "b1", branchName: "Main", quantity_kg: 1 }} idx={1} />
      </WarehouseColorProvider>,
    );
    expect(seen[0]).toBe(seen[1]);
    expect(seen[2]).toBe(WAREHOUSE_SHADES.milled[0]);
    expect(seen[0]).toBe(WAREHOUSE_SHADES.milled[1]);
  });
});

describe("the warehouse key", () => {
  const item = { type: "milled" as const, quantity_kg: 2100, locations: locs(6) };

  it("lists the biggest warehouses and says how many more there are", () => {
    render(<LocationKey item={item} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
    expect(screen.getByText(/\+3 more warehouses/)).toBeTruthy();
  });

  it("lists every warehouse when asked to (the spreadsheet)", () => {
    render(<LocationKey item={item} all />);
    expect(screen.getAllByRole("listitem")).toHaveLength(6);
    expect(screen.getByText("Warehouse 6")).toBeTruthy();
  });
});

describe("the page's colour key", () => {
  it("shows every warehouse with its total and narrows to one on click", () => {
    const onPick = vi.fn();
    render(
      <WarehouseLegend
        items={[
          { type: "milled", quantity_kg: 300, locations: locs(2) },
          { type: "palay", quantity_kg: 100, locations: [locs(3)[2]] },
        ]}
        onPick={onPick}
      />,
    );
    const legend = screen.getByTestId("warehouse-legend");
    expect(within(legend).getByText("3 warehouses")).toBeTruthy();
    fireEvent.click(within(legend).getByRole("button", { name: /Warehouse 3/ }));
    expect(onPick).toHaveBeenCalledWith("b3");
  });

  it("stays hidden when nothing is split between warehouses", () => {
    render(
      <WarehouseLegend
        items={[{ type: "milled", quantity_kg: 1, locations: locs(1) }]}
        onPick={() => {}}
      />,
    );
    expect(screen.queryByTestId("warehouse-legend")).toBeNull();
  });
});
