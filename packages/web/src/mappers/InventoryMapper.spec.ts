import { describe, it, expect } from "vitest";
import { InventoryMapper, type UnifiedItem } from "./InventoryMapper";

describe("InventoryMapper.toUnifiedItems", () => {
  it("normalizes palay / milled / byproduct rows into one list", () => {
    const palay = [
      {
        id: "1",
        variety: { code: "NSIC" },
        grade: { code: "A" },
        branch_id: "b1",
        branch: { name: "Main" },
        quantity_kg: "100",
      },
    ];
    const milled = [
      {
        id: "2",
        variety: { code: "RC" },
        grade_name: "premium",
        branch_id: null,
        branch: null,
        quantity_kg: 50,
      },
    ];
    const byproducts = [
      {
        id: "3",
        byproduct_type: "ipa",
        branch_id: "b1",
        branch: { name: "Main" },
        quantity_kg: 10,
      },
    ];

    const items = InventoryMapper.toUnifiedItems(palay, milled, byproducts);
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({
      id: "palay-1",
      type: "palay",
      variety: "NSIC",
      grade: "A",
      branchName: "Main",
      quantity_kg: 100,
    });
    expect(items[1]).toMatchObject({
      id: "milled-2",
      type: "milled",
      grade: "premium",
      branchName: "Unassigned",
      quantity_kg: 50,
    });
    expect(items[2]).toMatchObject({
      id: "bp-3",
      type: "byproduct",
      variety: "Ipa (Rice Hull)",
      grade: "—",
      quantity_kg: 10,
    });
  });

  it("falls back to em-dash / Unassigned for missing fields", () => {
    const items = InventoryMapper.toUnifiedItems(
      [{ id: "x", branch_id: null, quantity_kg: 0 }],
      [],
      [],
    );
    expect(items[0].variety).toBe("—");
    expect(items[0].grade).toBe("—");
    expect(items[0].branchName).toBe("Unassigned");
  });

  it("returns an empty list for all-empty input", () => {
    expect(InventoryMapper.toUnifiedItems([], [], [])).toEqual([]);
  });
});

describe("inventory order: grade, then the most stock, top to bottom", () => {
  const palayRow = (id: string, grade: string | null, kg: number) => ({
    id,
    variety: { code: "V" },
    grade: grade ? { code: grade } : null,
    branch_id: null,
    quantity_kg: kg,
  });

  it("sorts a kind by grade, then by stock, highest first", () => {
    const rows = [
      palayRow("c-big", "C", 900),
      palayRow("a-small", "A", 100),
      palayRow("a-big", "A", 5000),
      palayRow("nfa2", "NFA2", 300),
      palayRow("nfa1", "NFA1", 300),
      palayRow("b", "B", 20),
    ];
    const ids = InventoryMapper.sortRows(rows, "palay").map((r) => r.id);
    expect(ids).toEqual(["a-big", "a-small", "b", "c-big", "nfa1", "nfa2"]);
  });

  it("puts stock with no grade after the graded stock", () => {
    const rows = [palayRow("none", null, 99999), palayRow("a", "A", 1)];
    expect(InventoryMapper.sortRows(rows, "palay").map((r) => r.id)).toEqual(["a", "none"]);
  });

  it("does not change the rows it was given", () => {
    const rows = [palayRow("b", "B", 1), palayRow("a", "A", 1)];
    InventoryMapper.sortRows(rows, "palay");
    expect(rows.map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("orders by the sort the owner picked", () => {
    const rows = [
      { id: "b", variety: { code: "Rc222" }, grade: { code: "A" }, quantity_kg: 50 },
      { id: "a", variety: { code: "Rc216" }, grade: { code: "C" }, quantity_kg: 900 },
      { id: "c", variety: { code: "Rc218" }, grade: { code: "B" }, quantity_kg: 400 },
    ];
    const order = (sort: Parameters<typeof InventoryMapper.sortRows>[2]) =>
      InventoryMapper.sortRows(rows, "palay", sort).map((r) => r.id);

    expect(order("grade")).toEqual(["b", "c", "a"]);
    expect(order("most")).toEqual(["a", "c", "b"]);
    expect(order("least")).toEqual(["b", "c", "a"]);
    expect(order("variety")).toEqual(["a", "c", "b"]);
  });

  it("applies the picked sort inside each kind of a flat list", () => {
    const items = InventoryMapper.toUnifiedItems(
      [
        { id: "1", variety: { code: "V" }, grade: { code: "A" }, quantity_kg: 10 },
        { id: "2", variety: { code: "V" }, grade: { code: "B" }, quantity_kg: 500 },
      ],
      [{ id: "m", variety: { code: "V" }, grade_name: "A", quantity_kg: 1 }],
      [],
    );
    const ids = items.sort(InventoryMapper.comparator("most")).map((i) => i.id);
    // Palay first (biggest stock first), then the milled rice.
    expect(ids).toEqual(["palay-2", "palay-1", "milled-m"]);
  });

  it("keeps each kind together in a flat list, sorted by grade and stock inside it", () => {
    const items = InventoryMapper.toUnifiedItems(
      [palayRow("p-b", "B", 10), palayRow("p-a", "A", 10)],
      [
        { id: "m-small", variety: { code: "V" }, grade_name: "A", quantity_kg: 5 },
        { id: "m-big", variety: { code: "V" }, grade_name: "A", quantity_kg: 50 },
      ],
      [{ id: "bp", byproduct_type: "ipa", quantity_kg: 1000 }],
    );
    const ids = items.sort(InventoryMapper.compare).map((i) => i.id);
    expect(ids).toEqual(["palay-p-a", "palay-p-b", "milled-m-big", "milled-m-small", "bp-bp"]);
  });
});

describe("InventoryMapper.combineAcrossWarehouses", () => {
  const item = (
    id: string,
    branchId: string | null,
    branchName: string,
    quantity_kg: number,
    over: Partial<UnifiedItem> = {},
  ): UnifiedItem => ({
    id,
    type: "milled",
    typeLabel: "Milled Rice (Bigas)",
    variety: "Rc222",
    grade: "A",
    branchId,
    branchName,
    quantity_kg,
    color: "bg-emerald-500",
    ...over,
  });

  it("adds up the same variety and grade across warehouses and keeps each warehouse's share", () => {
    const [one] = InventoryMapper.combineAcrossWarehouses([
      item("milled-1", "b1", "Main Branch", 800),
      item("milled-2", "b2", "2nd Branch", 1200),
    ]);
    expect(one).toMatchObject({
      quantity_kg: 2000,
      branchId: null,
      branchName: "2 warehouses",
      locations: [
        { branchId: "b2", branchName: "2nd Branch", quantity_kg: 1200 },
        { branchId: "b1", branchName: "Main Branch", quantity_kg: 800 },
      ],
    });
  });

  it("adds up any number of warehouses, not just two or three", () => {
    const rows = Array.from({ length: 7 }, (_, n) =>
      item(`milled-${n}`, `b${n}`, `Warehouse ${n}`, (n + 1) * 10),
    );
    const [one] = InventoryMapper.combineAcrossWarehouses(rows);
    expect(one.quantity_kg).toBe(280);
    expect(one.branchName).toBe("7 warehouses");
    expect(one.locations).toHaveLength(7);
    expect(one.locations![0]).toMatchObject({ branchName: "Warehouse 6", quantity_kg: 70 });
  });

  it("keeps different grades, varieties and kinds apart", () => {
    const out = InventoryMapper.combineAcrossWarehouses([
      item("milled-1", "b1", "Main Branch", 800),
      item("milled-2", "b2", "2nd Branch", 100, { grade: "B" }),
      item("milled-3", "b2", "2nd Branch", 100, { variety: "Rc216" }),
      item("palay-4", "b2", "2nd Branch", 100, { type: "palay" }),
    ]);
    expect(out).toHaveLength(4);
    expect(out.every((i) => i.locations?.length === 1)).toBe(true);
  });

  it("leaves a single-warehouse item as it was, with its one location", () => {
    const [one] = InventoryMapper.combineAcrossWarehouses([item("milled-1", "b1", "Main", 5)]);
    expect(one).toMatchObject({ id: "milled-1", branchId: "b1", branchName: "Main" });
    expect(one.locations).toEqual([{ branchId: "b1", branchName: "Main", quantity_kg: 5 }]);
  });

  it("merges two rows of one variant in the same warehouse into one location", () => {
    const [one] = InventoryMapper.combineAcrossWarehouses([
      item("milled-1", "b1", "Main", 5),
      item("milled-2", "b1", "Main", 7),
    ]);
    expect(one).toMatchObject({ quantity_kg: 12, branchId: "b1", branchName: "Main" });
    expect(one.locations).toEqual([{ branchId: "b1", branchName: "Main", quantity_kg: 12 }]);
  });
});
