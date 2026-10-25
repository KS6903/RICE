import { describe, expect, it } from "vitest";
import { monthlyPayslip, sssCredit, withholdingTax } from "./payrollDeductions";

describe("sssCredit", () => {
  it.each([
    [1200, 5000],
    [5249.99, 5000],
    [5250, 5500],
    [5749.99, 5500],
    [5750, 6000],
    [13000, 13000],
    [14749.99, 14500],
    [14750, 15000],
    [34749.99, 34500],
    [34750, 35000],
    [250000, 35000],
  ])("pay of %d is credited at %d", (gross, credit) => {
    expect(sssCredit(gross)).toBe(credit);
  });
});

describe("withholdingTax", () => {
  it.each([
    [0, 0],
    [20833, 0],
    [27550, 1007.55],
    [33333, 1875],
    [66667, 8541.8],
    [95550, 15762.55],
    [166667, 33541.8],
    [666667, 183541.8],
    [700000, 195208.35],
  ])("taxable pay of %d withholds %d", (taxable, tax) => {
    expect(withholdingTax(taxable)).toBe(tax);
  });
});

describe("monthlyPayslip", () => {
  it("a ₱500-a-day laborer pays contributions but no tax", () => {
    expect(monthlyPayslip(13000)).toEqual({
      gross: 13000,
      sssCredit: 13000,
      sss: { employee: 650, employer: 1310 },
      philhealth: { employee: 325, employer: 325 },
      pagibig: { employee: 200, employer: 200 },
      taxable: 11825,
      withholdingTax: 0,
      totalDeductions: 1175,
      net: 11825,
    });
  });

  it("₱30,000 a month falls in the 15% bracket", () => {
    expect(monthlyPayslip(30000)).toEqual({
      gross: 30000,
      sssCredit: 30000,
      sss: { employee: 1500, employer: 3030 },
      philhealth: { employee: 750, employer: 750 },
      pagibig: { employee: 200, employer: 200 },
      taxable: 27550,
      withholdingTax: 1007.55,
      totalDeductions: 3457.55,
      net: 26542.45,
    });
  });

  it("caps SSS at ₱35,000 credit, PhilHealth at ₱100,000 and Pag-IBIG at ₱10,000", () => {
    const slip = monthlyPayslip(100000)!;
    expect(slip.sss).toEqual({ employee: 1750, employer: 3530 });
    expect(slip.philhealth).toEqual({ employee: 2500, employer: 2500 });
    expect(slip.pagibig).toEqual({ employee: 200, employer: 200 });
    expect(slip.withholdingTax).toBe(15762.55);
    expect(slip.net).toBe(79787.45);
    expect(monthlyPayslip(250000)!.philhealth.employee).toBe(2500);
  });

  it("very low pay still meets the SSS and PhilHealth floors, at 1% Pag-IBIG", () => {
    const slip = monthlyPayslip(1200)!;
    expect(slip.sss).toEqual({ employee: 250, employer: 510 });
    expect(slip.philhealth).toEqual({ employee: 250, employer: 250 });
    expect(slip.pagibig).toEqual({ employee: 12, employer: 24 });
    expect(slip.net).toBe(688);
  });

  it("has nothing to break down without pay", () => {
    expect(monthlyPayslip(0)).toBeNull();
    expect(monthlyPayslip(-5)).toBeNull();
    expect(monthlyPayslip(NaN)).toBeNull();
  });
});
