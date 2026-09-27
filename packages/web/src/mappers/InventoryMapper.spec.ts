import { describe, it, expect } from "vitest";
import { InventoryMapper } from "./InventoryMapper";

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
