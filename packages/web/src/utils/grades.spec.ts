import { describe, expect, it } from "vitest";
import { sortGrades } from "./grades";
import { MILLED_GRADES } from "../mappers/InventoryMapper";

const codes = (grades: { code: string }[]) => grades.map((g) => g.code);

describe("grades A to Z", () => {
  it("lists palay grades by code, whatever order they came in", () => {
    const grades = [
      { code: "NFA1" },
      { code: "C" },
      { code: "A" },
      { code: "Premium" },
      { code: "B" },
    ];
    expect(codes(sortGrades(grades))).toEqual(["A", "B", "C", "NFA1", "Premium"]);
  });

  it("puts a lower-case code beside its capital and counts numbers as numbers", () => {
    const grades = [{ code: "NFA10" }, { code: "b" }, { code: "NFA2" }, { code: "A" }];
    expect(codes(sortGrades(grades))).toEqual(["A", "b", "NFA2", "NFA10"]);
  });

  it("leaves the list it was given as it was", () => {
    const grades = [{ code: "B" }, { code: "A" }];
    sortGrades(grades);
    expect(codes(grades)).toEqual(["B", "A"]);
  });

  it("keeps the grades milled rice is stocked under A to Z", () => {
    expect([...MILLED_GRADES]).toEqual([...MILLED_GRADES].sort((a, b) => a.localeCompare(b)));
  });
});
